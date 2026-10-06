-- Run after schema.sql and catalog.sql. Additive; physical stock is not seeded.
begin;
alter table public.products add column if not exists version integer not null default 1;
alter table public.stock_counts add column if not exists details jsonb;
create table if not exists public.count_sessions (
 id uuid primary key, owner_id uuid not null, revision integer not null default 1,
 status text not null default 'draft' check(status in ('draft','published','discarded')),
 lines jsonb not null default '{}'::jsonb check(jsonb_typeof(lines)='object'),
 location text not null default '', updated_at timestamptz not null default now()
);
alter table public.count_sessions enable row level security;
drop policy if exists owner_read on public.count_sessions;
create policy owner_read on public.count_sessions for select to authenticated using(public.is_admin() and owner_id=auth.uid());
revoke all on public.count_sessions from public,anon,authenticated;
grant select on public.count_sessions to authenticated;

-- Annotate existing products once, keeping IDs, counts, rates and purchases intact.
update public.products set definition=definition || jsonb_build_object(
 'family',case when id='beer50' then 'Mariestad' when id='tap' then 'Norrlands' when id='smirnoff' then 'Smirnoff Ice' when id like 'redbull%' then 'Red Bull' else definition->>'name' end,
 'flavour','', 'location','Storage', 'shelf',(select count(*)*10 from public.products p2 where p2.id<products.id), 'archived',false,
 'kind',case when id in ('tap','beer50','cola','colazero','fanta','fantazero','sprite','spritezero','redbull','redbullzero') then 'staple' else 'occasional' end,
 'reorder',true,'countMode',case when id='tap' then 'keg' else 'pack' end,
 'sizeMl',case when id='tap' then 30000 when id in ('beer50','pet') then 500 when id='sparkling' then 750 when id='guinness' then 440 when id='smirnoff' then 275 when id like 'redbull%' then 250 else 330 end
) where not definition ? 'countMode';
update public.products set definition=jsonb_set(definition,'{name}','"Mariestad · 50 cl"') where id='beer50' and definition->>'name'='Beer · 50 cl';
update public.products set definition=jsonb_set(definition,'{name}','"Norrlands · 30 L tap"') where id='tap' and definition->>'name'='Tap beer';

create or replace function public.save_product(payload jsonb) returns integer language plpgsql security definer
set search_path=public,pg_temp as $$
declare d jsonb:=payload->'definition'; old public.products; v integer; n numeric;
begin
 perform public.require_admin(); perform pg_advisory_xact_lock(hashtext('qp-stock'));
 if coalesce(d->>'id','') !~ '^[a-zA-Z0-9_-]{1,80}$' or length(trim(coalesce(d->>'name',''))) not between 1 and 120 then raise exception 'Product needs an ID and name'; end if;
 if coalesce(d->>'countMode','') not in ('pack','bottle','keg') or coalesce(d->>'kind','') not in ('staple','seasonal','occasional') then raise exception 'Invalid product type'; end if;
 if coalesce(d->>'unit','') not in ('cans','bottles','pieces','glasses') then raise exception 'Invalid stock unit'; end if;
 if length(coalesce(d->>'family',''))>100 or length(coalesce(d->>'flavour',''))>100 or length(coalesce(d->>'location',''))>100 or length(coalesce(d->>'group',''))>100 or length(coalesce(d->>'supplier',''))>100 then raise exception 'Product labels are too long'; end if;
 n:=(d->>'shelf')::numeric;if n is null or n::text='NaN' or abs(n)>1000000 then raise exception 'Invalid shelf position';end if;
 if d->>'capacity' is not null and ((d->>'capacity')::numeric<0 or (d->>'capacity')::numeric>100000) then raise exception 'Invalid planning capacity';end if;
 n:=(d->>'pack')::numeric; if n is null or n::text='NaN' or n<1 or n>1000 or n<>trunc(n) then raise exception 'Pack size must be a positive whole number'; end if;
 n:=(d->>'sizeMl')::numeric; if n is null or n::text='NaN' or n<=0 or n>50000 then raise exception 'Enter a valid container size'; end if;
 if coalesce((d->>'rate')::numeric,-1)<0 or coalesce((d->>'minimum')::numeric,-1)<0 or (d->>'rate')::numeric>100000 or (d->>'minimum')::numeric>100000 then raise exception 'Invalid planning quantities'; end if;
 if coalesce((d->>'requestFactor')::numeric,0)<>(case when d->>'id'='tap' then 50 else 1 end) then raise exception 'Invalid request conversion'; end if;
 if (d->>'countMode'='keg')<>(d->>'id'='tap') then raise exception 'Use the existing tap product for keg slots'; end if;
 if d->>'countMode'='bottle' and (d->>'unit'<>'bottles' or (d->>'pack')::numeric<>1) then raise exception 'Opened bottles use individual bottles'; end if;
 if jsonb_typeof(d->'archived') is distinct from 'boolean' or jsonb_typeof(d->'reorder') is distinct from 'boolean' then raise exception 'Invalid product switches'; end if;
 select * into old from public.products where id=d->>'id' for update;
 if found then
   if old.version<>(payload->>'version')::integer or payload->>'version' is null then raise exception 'Product changed elsewhere. Refresh before editing'; end if;
   if old.definition->>'unit' is distinct from d->>'unit' or old.definition->>'countMode' is distinct from d->>'countMode' or (old.definition->>'sizeMl')::numeric is distinct from (d->>'sizeMl')::numeric then raise exception 'Create a new variant to change container size or counting unit'; end if;
   if d->>'id'='tap' and ((d->>'pack')::numeric<>50 or (d->>'sizeMl')::numeric<>30000) then raise exception 'Tap conversion must remain 50 usable glasses per 30 L keg'; end if;
   update public.products set definition=d,version=version+1 where id=old.id returning version into v;
 else
   if coalesce((payload->>'version')::integer,0)<>0 then raise exception 'Product no longer exists'; end if;
   insert into public.products(id,definition) values(d->>'id',d) returning version into v;
 end if;
 -- The product editor owns these planning fields; avoid stale per-product overrides.
 delete from public.product_settings where id=d->>'id';
 perform public.audit('product_edited',jsonb_build_object('id',d->>'id','version',v));return v;
end; $$;

create or replace function public.save_count_session(payload jsonb) returns integer language plpgsql security definer
set search_path=public,pg_temp as $$
declare s public.count_sessions; v integer;
begin
 perform public.require_admin(); perform pg_advisory_xact_lock(hashtext('qp-stock'));
 if jsonb_typeof(payload->'lines') is distinct from 'object' or length((payload->'lines')::text)>500000 then raise exception 'Invalid count draft'; end if;
 select * into s from public.count_sessions where id=(payload->>'id')::uuid for update;
 if found then
  if s.owner_id<>auth.uid() or s.status<>'draft' then raise exception 'This draft is not editable'; end if;
  if s.revision<>(payload->>'revision')::integer or payload->>'revision' is null then raise exception 'Draft changed on another device. Reload before continuing'; end if;
  update public.count_sessions set lines=payload->'lines',location=left(coalesce(payload->>'location',''),100),revision=revision+1,updated_at=now() where id=s.id returning revision into v;
 else
  if coalesce((payload->>'revision')::integer,0)<>0 then raise exception 'Draft no longer exists'; end if;
  insert into public.count_sessions(id,owner_id,lines,location) values((payload->>'id')::uuid,auth.uid(),payload->'lines',left(coalesce(payload->>'location',''),100)) returning revision into v;
 end if;
 return v;
end; $$;

create or replace function public.finish_count_session(payload jsonb) returns boolean language plpgsql security definer
set search_path=public,pg_temp as $$
declare s public.count_sessions; item record; p public.products; line jsonb; q numeric; f numeric; part jsonb; stamp timestamptz; latest timestamptz; confirmed integer:=0;
begin
 perform public.require_admin(); perform pg_advisory_xact_lock(hashtext('qp-stock'));
 select * into s from public.count_sessions where id=(payload->>'id')::uuid for update;
 if not found or s.owner_id<>auth.uid() then raise exception 'Count draft not found'; end if;
 if s.status='published' and coalesce((payload->>'discard')::boolean,false)=false then return true; end if;
 if s.status<>'draft' or s.revision is distinct from (payload->>'revision')::integer then raise exception 'Draft changed. Reload before continuing'; end if;
 if coalesce((payload->>'discard')::boolean,false) then update public.count_sessions set status='discarded',updated_at=now() where id=s.id;return true;end if;
 for item in select * from jsonb_each(s.lines) loop
  line:=item.value;
  if not coalesce((line->>'confirmed')::boolean,false) then continue; end if;
  select * into p from public.products where id=item.key;
  if not found or coalesce((p.definition->>'archived')::boolean,false) or p.id='tap' then raise exception 'Product is unavailable; revise the count'; end if;
  if p.version is distinct from (line->>'productVersion')::integer then raise exception 'Product changed since counting; recount %',p.definition->>'name'; end if;
  stamp:=(line->>'counted_at')::timestamptz;
  if stamp is null or stamp>now()+interval '1 minute' then raise exception 'Invalid count time'; end if;
  select max(counted_at) into latest from public.stock_counts where product_id=p.id;
  if latest is distinct from (line->>'baseline')::timestamptz then raise exception 'Another count was published for %. Recount it',p.definition->>'name'; end if;
  if latest is not null and stamp<latest then raise exception 'Count is older than the current baseline'; end if;
  q:=(line->>'full')::numeric;
  if q is null or q::text='NaN' or q<0 or q<>trunc(q) then raise exception 'Full packs or bottles must be whole numbers'; end if;
  if p.definition->>'countMode'='bottle' then
   if jsonb_typeof(line->'opened') is distinct from 'array' then raise exception 'Invalid opened bottles'; end if;
   for part in select * from jsonb_array_elements(line->'opened') loop
    f:=part::text::numeric;if f is null or f::text='NaN' or f<0 or f>1 then raise exception 'Opened bottle fraction must be between zero and one';end if;q:=q+f;
   end loop;
  else
   f:=(line->>'loose')::numeric;if f is null or f::text='NaN' or f<0 or f<>trunc(f) then raise exception 'Loose units must be whole numbers';end if;
   q:=q*(p.definition->>'pack')::numeric+f;
  end if;
  if q>100000 then raise exception 'Count is too large'; end if;
  insert into public.stock_counts(batch_id,product_id,quantity,counted_at,created_by,details) values(s.id,p.id,q,stamp,auth.uid(),line || jsonb_build_object('pack',p.definition->'pack','sizeMl',p.definition->'sizeMl','estimated',p.definition->>'countMode'='bottle' and jsonb_array_length(line->'opened')>0));
  confirmed:=confirmed+1;
 end loop;
 if confirmed=0 then raise exception 'Confirm at least one product';end if;
 update public.count_sessions set status='published',revision=revision+1,updated_at=now() where id=s.id;
 perform public.audit('count_session_published',jsonb_build_object('id',s.id,'products',confirmed));return true;
end; $$;
revoke all on function public.save_product(jsonb),public.save_count_session(jsonb),public.finish_count_session(jsonb) from public,anon,authenticated;
grant execute on function public.save_product(jsonb),public.save_count_session(jsonb),public.finish_count_session(jsonb) to authenticated;
create or replace function public.check_active_request_products() returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$ declare line jsonb; begin
 for line in select * from jsonb_array_elements(new.lines) loop
  if not exists(select 1 from public.products where id=line->>'product_id' and not coalesce((definition->>'archived')::boolean,false)) then raise exception 'Product is archived or unavailable'; end if;
 end loop;return new;
end; $$;
revoke all on function public.check_active_request_products() from public,anon,authenticated;
drop trigger if exists active_request_products on public.order_requests;
create trigger active_request_products before insert or update of lines on public.order_requests for each row execute function public.check_active_request_products();
commit;
