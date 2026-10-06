-- QP Stock Room: run once in a new Supabase project's SQL editor.
-- Public GitHub Pages files contain no organization data or privileged key.
begin;

create table public.members (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('member','admin')),
  active boolean not null default true
);
create function public.my_role() returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select role from public.members where auth.uid() is not null
    and email = lower(auth.jwt()->>'email') and active;
$$;
create function public.is_member() returns boolean language sql stable security definer
set search_path = public, pg_temp as $$ select public.my_role() is not null; $$;
create function public.is_admin() returns boolean language sql stable security definer
set search_path = public, pg_temp as $$ select coalesce(public.my_role()='admin',false); $$;
create function public.require_admin() returns void language plpgsql security definer
set search_path = public, pg_temp as $$ begin
  if not public.is_admin() then raise exception 'Barmaster access required' using errcode='42501'; end if;
end; $$;

create table public.products (id text primary key, definition jsonb not null);
create table public.product_settings (id text primary key references public.products, definition jsonb not null);
create table public.stock_counts (
  id uuid primary key default gen_random_uuid(), batch_id uuid not null,
  product_id text not null references public.products,
  quantity numeric not null check(quantity >= 0 and quantity <= 100000),
  counted_at timestamptz not null, created_at timestamptz not null default now(), created_by uuid,
  unique(batch_id,product_id)
);
create index on public.stock_counts(product_id,counted_at desc);
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(), batch_id uuid not null,
  product_id text not null references public.products,
  quantity numeric not null check(quantity <> 0 and abs(quantity)<=10000),
  kind text not null check(kind in ('delivery','breakage')),
  reference text not null check(length(reference) between 1 and 150),
  occurred_at timestamptz not null, created_at timestamptz not null default now(), created_by uuid,
  unique(reference,product_id), unique(batch_id,product_id),
  check ((kind='delivery' and quantity>0) or (kind='breakage' and quantity<0))
);
create index on public.stock_movements(product_id,occurred_at);
create table public.events (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 120),
  starts_at timestamptz not null, multiplier numeric not null check(multiplier between 0 and 10),
  cancelled boolean not null default false
);
create table public.order_requests (
  id uuid primary key, user_id uuid not null references auth.users,
  requester_name text not null check(length(requester_name) between 1 and 100),
  event_name text not null check(length(event_name) between 1 and 120), event_date date not null,
  guests integer not null check(guests between 1 and 10000),
  lines jsonb not null check(jsonb_typeof(lines)='array' and jsonb_array_length(lines) between 1 and 30),
  notes text not null default '' check(length(notes)<=2000),
  status text not null default 'pending' check(status in ('pending','approved','changes_requested','rejected')),
  event_id uuid references public.events,
  review_note text check(length(review_note)<=1000), reviewed_by uuid, reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check(status<>'approved' or event_id is not null)
);
create index on public.order_requests(user_id,created_at desc);
create table public.keg_slots (
  id text primary key, slot integer unique not null check(slot between 1 and 7),
  state text not null check(state in ('empty','warm','chilling','cold','on_tap')),
  glasses integer not null check(glasses between 0 and 50), chilled_since timestamptz,
  check((slot<=3 and state<>'warm') or (slot>3 and state in ('warm','empty'))),
  check((state='empty' and glasses=0) or (state<>'empty' and glasses>0)),
  check((slot>3 and chilled_since is null) or (state='empty' and chilled_since is null) or (slot<=3 and state<>'empty' and chilled_since is not null))
);
insert into public.keg_slots(id,slot,state,glasses) select n::text,n,'empty',0 from generate_series(1,7)n;
create table public.sales_imports (
  id text primary key, filename text not null, range_start date not null, range_end date not null,
  first_sale date not null, last_sale date not null,
  source_rows integer not null, included_rows integer not null, excluded_rows integer not null,
  unclassified_rows integer not null, refund_rows integer not null,
  gross_ore bigint not null, quantity numeric not null,
  created_at timestamptz not null default now(), check(range_start<=range_end)
);
create table public.sales_daily (
  id bigint generated always as identity primary key, import_id text not null references public.sales_imports,
  date date not null, category text not null check(category in ('QP','QP-NPR','QP-VPR','QP-Pitbull','QP-Plåt')),
  product text not null, quantity numeric not null, gross_ore bigint not null, source_rows integer not null,
  unique(date,category,product)
);
create index on public.sales_daily(date,category);
create table public.audit_log (
  id bigint generated always as identity primary key, actor uuid, action text not null,
  details jsonb not null, created_at timestamptz not null default now()
);
create function public.audit(action text, details jsonb) returns void language sql security definer
set search_path = public, pg_temp as $$ insert into public.audit_log(actor,action,details) values(auth.uid(),action,details); $$;

-- Row-level authorization applies to direct REST calls as well as the UI.
alter table public.members enable row level security;
create policy member_self on public.members for select to authenticated
using (public.is_admin() or (auth.uid() is not null and email=lower(auth.jwt()->>'email')));
do $$ declare name text; begin
  foreach name in array array['products','product_settings','stock_counts','stock_movements','events','keg_slots','sales_imports','sales_daily'] loop
    execute format('alter table public.%I enable row level security',name);
    execute format('create policy member_read on public.%I for select to authenticated using (public.is_member())',name);
  end loop;
end $$;
alter table public.order_requests enable row level security;
create policy request_owner_read on public.order_requests for select to authenticated
using (public.is_member() and (user_id=auth.uid() or public.is_admin()));
alter table public.audit_log enable row level security;
create policy audit_admin_read on public.audit_log for select to authenticated using(public.is_admin());

-- Members need aggregate approved demand for forecasts, but not other members'
-- names, contacts, notes or request records. This is a deliberately narrow RPC.
create function public.approved_demand() returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$ begin
  if not public.is_member() then raise exception 'Membership required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('event_id',event_id,'status','approved','lines',lines)) from (
    select event_id,jsonb_agg(jsonb_build_object('product_id',product_id,'quantity',quantity)) lines from (
      select event_id,l->>'product_id' product_id,sum((l->>'quantity')::numeric) quantity
      from public.order_requests cross join lateral jsonb_array_elements(lines)l where status='approved'
      group by event_id,l->>'product_id'
    ) products_by_event group by event_id
  ) aggregated),'[]'::jsonb);
end; $$;

create function public.submit_request(payload jsonb) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare request_id uuid := (payload->>'id')::uuid; line jsonb; existing public.order_requests; begin
  if not public.is_member() then raise exception 'Membership required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext('qp-requests'));
  select * into existing from public.order_requests where id=request_id;
  if found then
    if existing.user_id<>auth.uid() then raise exception 'Request reference already exists'; end if;
    if existing.event_name<>trim(payload->>'event_name') or existing.event_date<>(payload->>'event_date')::date
      or existing.guests<>(payload->>'guests')::integer or existing.lines<>payload->'lines'
      or existing.requester_name<>trim(payload->>'requester_name') or existing.notes<>coalesce(payload->>'notes','') then
      raise exception 'This reference was submitted with different details. Refresh before resubmitting.';
    end if;
    return request_id;
  end if;
  if (payload->>'event_date')::date < (now() at time zone 'Europe/Stockholm')::date then raise exception 'Choose today or a future date'; end if;
  if jsonb_typeof(payload->'lines')<>'array' or jsonb_array_length(payload->'lines') not between 1 and 30 then raise exception 'Add 1 to 30 products'; end if;
  if (select count(*)<>count(distinct l->>'product_id') from jsonb_array_elements(payload->'lines')l) then raise exception 'A product can appear only once'; end if;
  if (payload->>'guests')::numeric<>trunc((payload->>'guests')::numeric) then raise exception 'Customers must be a whole number'; end if;
  for line in select * from jsonb_array_elements(payload->'lines') loop
    if not exists(select 1 from public.products where id=line->>'product_id')
      or coalesce((line->>'quantity')::numeric,0) not between 1 and 10000
      or (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric) then raise exception 'Invalid product or quantity'; end if;
  end loop;
  insert into public.order_requests(id,user_id,requester_name,event_name,event_date,guests,lines,notes)
    values(request_id,auth.uid(),trim(payload->>'requester_name'),trim(payload->>'event_name'),(payload->>'event_date')::date,
      (payload->>'guests')::integer,payload->'lines',coalesce(payload->>'notes',''));
  perform public.audit('request_submitted',jsonb_build_object('id',request_id));
  return request_id;
end; $$;

create function public.revise_request(payload jsonb) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$ declare item public.order_requests; line jsonb; begin
  if not public.is_member() then raise exception 'Membership required' using errcode='42501'; end if;
  select * into item from public.order_requests where id=(payload->>'id')::uuid and user_id=auth.uid() for update;
  if not found or item.status<>'changes_requested' then raise exception 'Only your requests awaiting changes can be revised'; end if;
  if (payload->>'event_date')::date < (now() at time zone 'Europe/Stockholm')::date then raise exception 'Choose today or a future date'; end if;
  if jsonb_typeof(payload->'lines')<>'array' or jsonb_array_length(payload->'lines') not between 1 and 30 then raise exception 'Add 1 to 30 products'; end if;
  if (select count(*)<>count(distinct l->>'product_id') from jsonb_array_elements(payload->'lines')l) then raise exception 'A product can appear only once'; end if;
  if (payload->>'guests')::numeric<>trunc((payload->>'guests')::numeric) then raise exception 'Customers must be a whole number'; end if;
  for line in select * from jsonb_array_elements(payload->'lines') loop
    if not exists(select 1 from public.products where id=line->>'product_id') or coalesce((line->>'quantity')::numeric,0) not between 1 and 10000 or (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric) then raise exception 'Invalid product or quantity'; end if;
  end loop;
  update public.order_requests set requester_name=trim(payload->>'requester_name'),event_name=trim(payload->>'event_name'),event_date=(payload->>'event_date')::date,
    guests=(payload->>'guests')::integer,lines=payload->'lines',notes=coalesce(payload->>'notes',''),status='pending',event_id=null,review_note=null,reviewed_at=null,reviewed_by=null where id=item.id;
  perform public.audit('request_revised',jsonb_build_object('id',item.id)); return item.id;
end; $$;

create function public.review_request(payload jsonb) returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$ declare request public.order_requests; target public.events; begin
  perform public.require_admin();
  select * into request from public.order_requests where id=(payload->>'id')::uuid for update;
  if not found then raise exception 'Request not found'; end if;
  if request.status not in ('pending','changes_requested') then raise exception 'This request has already been decided. Refresh the inbox.'; end if;
  if payload->>'status' not in ('approved','changes_requested','rejected') then raise exception 'Invalid decision'; end if;
  if payload->>'status'='approved' then
    select * into target from public.events where id=(payload->>'event_id')::uuid;
    if not found or target.cancelled or (target.starts_at at time zone 'Europe/Stockholm')::date<>request.event_date then
      raise exception 'Approval requires an active opening on the requested date';
    end if;
  elsif length(trim(coalesce(payload->>'note','')))=0 then raise exception 'Add a reason for the organizer'; end if;
  update public.order_requests set status=payload->>'status',event_id=case when payload->>'status'='approved' then (payload->>'event_id')::uuid else null end,
    review_note=payload->>'note',reviewed_by=auth.uid(),reviewed_at=now() where id=request.id;
  perform public.audit('request_reviewed',payload); return true;
end; $$;

create function public.save_count(payload jsonb) returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$ declare line jsonb; capacity numeric; begin
  perform public.require_admin(); perform pg_advisory_xact_lock(hashtext('qp-stock'));
  if (payload->>'counted_at')::timestamptz>now()+interval '1 minute' then raise exception 'A count cannot be in the future'; end if;
  if jsonb_array_length(payload->'lines')<1 then raise exception 'Enter a stock quantity'; end if;
  for line in select * from jsonb_array_elements(payload->'lines') loop
    if line->>'product_id'='tap' then raise exception 'Use the keg count for tap beer'; end if;
    select (definition->>'capacity')::numeric into capacity from public.products where id=line->>'product_id';
    if (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric) or (line->>'quantity')::numeric>capacity then raise exception 'Invalid quantity or storage capacity exceeded'; end if;
    insert into public.stock_counts(batch_id,product_id,quantity,counted_at,created_by)
      values((payload->>'id')::uuid,line->>'product_id',(line->>'quantity')::numeric,(payload->>'counted_at')::timestamptz,auth.uid())
      on conflict(batch_id,product_id) do nothing;
  end loop;
  perform public.audit('stock_count',payload); return true;
end; $$;

create function public.record_movement(payload jsonb) returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$ declare line jsonb; begin
  perform public.require_admin(); perform pg_advisory_xact_lock(hashtext('qp-stock'));
  if exists(select 1 from public.stock_movements where batch_id=(payload->>'id')::uuid) then return true; end if;
  if exists(select 1 from public.stock_movements where reference=trim(payload->>'reference')) then raise exception 'This reference was already received or logged'; end if;
  if (payload->>'occurred_at')::timestamptz>now()+interval '1 minute' then raise exception 'Stock movements cannot be in the future'; end if;
  if jsonb_array_length(payload->'lines')<1 then raise exception 'Enter a quantity'; end if;
  for line in select * from jsonb_array_elements(payload->'lines') loop
    if line->>'product_id'='tap' then raise exception 'Update keg slots to receive or discard kegs'; end if;
    if (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric) then raise exception 'Use whole units'; end if;
    insert into public.stock_movements(batch_id,product_id,quantity,kind,reference,occurred_at,created_by)
      values((payload->>'id')::uuid,line->>'product_id',(line->>'quantity')::numeric,payload->>'kind',trim(payload->>'reference'),(payload->>'occurred_at')::timestamptz,auth.uid());
  end loop;
  perform public.audit('stock_movement',payload); return true;
end; $$;

create function public.save_kegs(payload jsonb) returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$ declare keg jsonb; n integer; begin
  perform public.require_admin(); perform pg_advisory_xact_lock(hashtext('qp-stock'));
  if exists(select 1 from public.stock_counts where batch_id=(payload->>'id')::uuid) then return true; end if;
  if jsonb_array_length(payload->'kegs')<>7 or (select count(distinct k->>'slot') from jsonb_array_elements(payload->'kegs')k)<>7 then raise exception 'Provide all seven unique keg slots'; end if;
  for keg in select * from jsonb_array_elements(payload->'kegs') loop
    n:=(keg->>'slot')::integer;
    if n not between 1 and 7 or (keg->>'glasses')::numeric<>trunc((keg->>'glasses')::numeric) then raise exception 'Invalid keg slot or quantity'; end if;
    if (keg->>'chilled_since')::timestamptz>now() then raise exception 'Chilling cannot start in the future'; end if;
    if keg->>'state' in ('cold','on_tap') and ((keg->>'chilled_since') is null or (keg->>'chilled_since')::timestamptz>now()-interval '48 hours') then raise exception 'Cold kegs require 48 hours of chilling'; end if;
    update public.keg_slots set state=keg->>'state',glasses=(keg->>'glasses')::integer,chilled_since=(keg->>'chilled_since')::timestamptz where slot=n;
  end loop;
  insert into public.stock_counts(batch_id,product_id,quantity,counted_at,created_by)
    select (payload->>'id')::uuid,'tap',sum(glasses),now(),auth.uid() from public.keg_slots;
  perform public.audit('keg_count',payload); return true;
end; $$;

create function public.save_event(payload jsonb) returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$ begin
  perform public.require_admin(); perform pg_advisory_xact_lock(hashtext('qp-stock'));
  if exists(select 1 from public.order_requests where event_id=(payload->>'id')::uuid and status='approved' and event_date<>((payload->>'starts_at')::timestamptz at time zone 'Europe/Stockholm')::date) then raise exception 'Approved requests are linked to this date. Resolve them before moving the opening.'; end if;
  insert into public.events(id,name,starts_at,multiplier,cancelled) values((payload->>'id')::uuid,trim(payload->>'name'),(payload->>'starts_at')::timestamptz,(payload->>'multiplier')::numeric,coalesce((payload->>'cancelled')::boolean,false))
    on conflict(id) do update set name=excluded.name,starts_at=excluded.starts_at,multiplier=excluded.multiplier,cancelled=excluded.cancelled;
  perform public.audit('opening_saved',payload); return true;
end; $$;

create function public.save_settings(payload jsonb) returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$ declare product jsonb; capacity numeric; minimum numeric; begin
  perform public.require_admin();
  for product in select * from jsonb_array_elements(payload->'products') loop
    select (definition->>'capacity')::numeric into capacity from public.products where id=product->>'id';
    minimum:=(product->>'minimum')::numeric;
    if minimum is null or minimum<0 or minimum>coalesce(capacity,1000) then raise exception 'Reserve is outside capacity'; end if;
    insert into public.product_settings(id,definition) values(product->>'id',jsonb_build_object('minimum',minimum))
      on conflict(id) do update set definition=excluded.definition;
  end loop;
  perform public.audit('reserves_saved',payload); return true;
end; $$;

-- Trusted imports only. This function is intentionally NOT available to browser roles.
-- Repeating the exact file is safe. Overlapping exports need explicit reconciliation.
create function public.import_sales_admin(payload jsonb) returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$ declare meta jsonb:=payload->'meta'; line jsonb; begin
  perform pg_advisory_xact_lock(hashtext('qp-sales-import'));
  if exists(select 1 from public.sales_imports where id=meta->>'id') then return false; end if;
  if exists(select 1 from public.sales_imports where range_start<=(meta->>'range_end')::date and range_end>=(meta->>'range_start')::date) then raise exception 'This export overlaps existing history; reconcile dates before importing'; end if;
  if (select sum((r->>'gross_ore')::bigint) from jsonb_array_elements(payload->'rows')r)<>(meta->>'gross_ore')::bigint then raise exception 'Sales total does not reconcile'; end if;
  if (select sum((r->>'quantity')::numeric) from jsonb_array_elements(payload->'rows')r)<>(meta->>'quantity')::numeric then raise exception 'Unit total does not reconcile'; end if;
  insert into public.sales_imports(id,filename,range_start,range_end,first_sale,last_sale,source_rows,included_rows,excluded_rows,unclassified_rows,refund_rows,gross_ore,quantity)
    values(meta->>'id',meta->>'filename',(meta->>'range_start')::date,(meta->>'range_end')::date,(meta->>'first_sale')::date,(meta->>'last_sale')::date,(meta->>'source_rows')::integer,(meta->>'included_rows')::integer,(meta->>'excluded_rows')::integer,(meta->>'unclassified_rows')::integer,(meta->>'refund_rows')::integer,(meta->>'gross_ore')::bigint,(meta->>'quantity')::numeric);
  for line in select * from jsonb_array_elements(payload->'rows') loop
    if (line->>'date')::date not between (meta->>'range_start')::date and (meta->>'range_end')::date then raise exception 'Sale outside import coverage'; end if;
    insert into public.sales_daily(import_id,date,category,product,quantity,gross_ore,source_rows)
      values(meta->>'id',(line->>'date')::date,line->>'category',line->>'product',(line->>'quantity')::numeric,(line->>'gross_ore')::bigint,(line->>'source_rows')::integer);
  end loop;
  perform public.audit('sales_import',meta); return true;
end; $$;

-- Supabase defaults can grant overly broad table/function access; narrow it here.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.members,public.products,public.product_settings,public.stock_counts,public.stock_movements,public.events,public.order_requests,public.keg_slots,public.sales_imports,public.sales_daily,public.audit_log to authenticated;
grant execute on function public.my_role(),public.is_member(),public.is_admin(),public.approved_demand() to authenticated;
grant execute on function public.submit_request(jsonb),public.revise_request(jsonb),public.review_request(jsonb),public.save_count(jsonb),public.record_movement(jsonb),public.save_kegs(jsonb),public.save_event(jsonb),public.save_settings(jsonb) to authenticated;
grant execute on function public.import_sales_admin(jsonb) to service_role;
commit;
