-- Run after schema.sql and inventory.sql. Supplier orders are private to barmasters.
begin;
create table if not exists public.supplier_orders (
 id uuid primary key, reference text not null unique check(length(trim(reference)) between 1 and 120),
 supplier text not null check(length(trim(supplier)) between 1 and 100), delivery_date date not null,
 version integer not null default 1, status text not null default 'ordered' check(status in ('ordered','received')),
 lines jsonb not null check(jsonb_typeof(lines)='array'), receipt jsonb,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), received_at timestamptz
);
alter table public.supplier_orders enable row level security;
drop policy if exists supplier_orders_admin_read on public.supplier_orders;
create policy supplier_orders_admin_read on public.supplier_orders for select to authenticated using(public.is_admin());
revoke all on public.supplier_orders from anon,authenticated;
grant select on public.supplier_orders to authenticated;

create or replace function public.save_supplier_order(payload jsonb) returns integer language plpgsql security definer
set search_path=public,pg_temp as $$
declare item public.supplier_orders; line jsonb; p jsonb; pack numeric; full_n numeric; loose_n numeric; q numeric; cleaned jsonb='[]'; seen text[]='{}'; next_v integer;
begin
 perform public.require_admin(); perform pg_advisory_xact_lock(hashtext('qp-stock'));
 select * into item from public.supplier_orders where id=(payload->>'id')::uuid for update;
 if found then
  if item.status<>'ordered' then raise exception 'This delivery is already received'; end if;
  if item.version is distinct from (payload->>'version')::integer then raise exception 'Order changed on another device. Reopen it.'; end if;
  next_v=item.version+1;
 else
  if coalesce((payload->>'version')::integer,0)<>0 then raise exception 'Order no longer exists'; end if; next_v=1;
 end if;
 if jsonb_typeof(payload->'lines') is distinct from 'array' or jsonb_array_length(payload->'lines') not between 1 and 100 then raise exception 'Choose 1–100 products'; end if;
 for line in select * from jsonb_array_elements(payload->'lines') loop
  if line->>'product_id'=any(seen) then raise exception 'Duplicate product'; end if; seen=array_append(seen,line->>'product_id');
  select definition into p from public.products where id=line->>'product_id';
  if p is null or coalesce((p->>'archived')::boolean,false) then raise exception 'Product is unavailable'; end if;
  pack=case when p->>'countMode'='bottle' then 1 else (p->>'pack')::numeric end;
  full_n=(line->>'full')::numeric; loose_n=(line->>'loose')::numeric;
  if full_n is null or loose_n is null or full_n<0 or loose_n<0 or full_n<>trunc(full_n) or loose_n<>trunc(loose_n) then raise exception 'Use whole packs and units'; end if;
  if p->>'countMode'='keg' and loose_n<>0 then raise exception 'Receive whole kegs'; end if;
  q=full_n*pack+loose_n;
  if q not between 1 and 10000 then raise exception 'Order quantity must be 1–10000 units'; end if;
  cleaned=cleaned||jsonb_build_array(jsonb_build_object('product_id',line->>'product_id','name',p->>'name','unit',p->>'unit','mode',p->>'countMode','pack',pack,'full',full_n,'loose',loose_n,'quantity',case when coalesce((payload->>'unplanned')::boolean,false) then null else q end));
 end loop;
 insert into public.supplier_orders(id,reference,supplier,delivery_date,version,lines,created_by)
 values((payload->>'id')::uuid,trim(payload->>'reference'),trim(payload->>'supplier'),(payload->>'delivery_date')::date,next_v,cleaned,auth.uid())
 on conflict(id) do update set reference=excluded.reference,supplier=excluded.supplier,delivery_date=excluded.delivery_date,version=excluded.version,lines=excluded.lines;
 perform public.audit('supplier_order_saved',jsonb_build_object('id',payload->>'id','version',next_v)); return next_v;
end; $$;

create or replace function public.receive_supplier_order(payload jsonb) returns boolean language plpgsql security definer
set search_path=public,pg_temp as $$
declare item public.supplier_orders; expected jsonb; actual jsonb; result jsonb='[]'; full_n numeric; loose_n numeric; q numeric; diff numeric; mismatch boolean=false; received_time timestamptz; slot_id integer; keg_n integer; seen text[]='{}';
begin
 perform public.require_admin(); perform pg_advisory_xact_lock(hashtext('qp-stock'));
 select * into item from public.supplier_orders where id=(payload->>'id')::uuid for update;
 if not found then raise exception 'Order not found'; end if;
 -- A retry never increments stock twice, including a zero-quantity receipt.
 if item.status='received' then return true; end if;
 if item.version is distinct from (payload->>'version')::integer then raise exception 'Order changed. Reopen the delivery.'; end if;
 received_time=(payload->>'received_at')::timestamptz;
 if received_time is null or received_time>now()+interval '1 minute' or received_time<item.created_at then raise exception 'Use the actual receiving time'; end if;
 if jsonb_typeof(payload->'lines') is distinct from 'array' or jsonb_array_length(payload->'lines')<>jsonb_array_length(item.lines) then raise exception 'Check every ordered product, including missing items'; end if;
 for actual in select * from jsonb_array_elements(payload->'lines') loop
  if actual->>'product_id'=any(seen) then raise exception 'Duplicate received product'; end if; seen=array_append(seen,actual->>'product_id');
  select e into expected from jsonb_array_elements(item.lines)e where e->>'product_id'=actual->>'product_id';
  if expected is null or (actual->>'checked')::boolean is distinct from true then raise exception 'Confirm each product'; end if;
  full_n=(actual->>'full')::numeric;loose_n=(actual->>'loose')::numeric;
  if full_n is null or loose_n is null or full_n<0 or loose_n<0 or full_n<>trunc(full_n) or loose_n<>trunc(loose_n) then raise exception 'Use whole packs and units'; end if;
  if expected->>'mode'='keg' and loose_n<>0 then raise exception 'Receive whole kegs'; end if;
  q=full_n*(expected->>'pack')::numeric+loose_n;
  if q not between 0 and 10000 then raise exception 'Received quantity must be 0–10000 units'; end if;
  diff=q-(expected->>'quantity')::numeric; mismatch=mismatch or coalesce(diff<>0,false);
  result=result||jsonb_build_array(expected||jsonb_build_object('received',q,'difference',diff,'received_full',full_n,'received_loose',loose_n));
  if q>0 then
   if expected->>'mode'='keg' then
    keg_n=full_n::integer;
    if keg_n>(select count(*) from public.keg_slots where state='empty') then raise exception 'Not enough empty keg slots. Update the keg slots first.'; end if;
    for slot_id in select slot from public.keg_slots where state='empty' order by (slot<=3),slot limit keg_n loop
     update public.keg_slots set state=case when slot_id<=3 then 'chilling' else 'warm' end,glasses=50,chilled_since=case when slot_id<=3 then received_time else null end where slot=slot_id;
    end loop;
   end if;
   insert into public.stock_movements(batch_id,product_id,quantity,kind,reference,occurred_at,created_by)
   values(item.id,expected->>'product_id',q,'delivery','Supplier order '||item.id,received_time,auth.uid());
  end if;
 end loop;
 if mismatch and (length(trim(coalesce(payload->>'note','')))<3 or length(payload->>'note')>2000) then raise exception 'Add a note explaining missing or extra items'; end if;
 update public.supplier_orders set status='received',version=version+1,received_at=received_time,receipt=jsonb_build_object('lines',result,'note',left(coalesce(payload->>'note',''),2000),'received_by',auth.uid()) where id=item.id;
 perform public.audit('supplier_order_received',jsonb_build_object('id',item.id,'receipt',result)); return true;
end; $$;
revoke all on function public.save_supplier_order(jsonb),public.receive_supplier_order(jsonb) from public,anon;
grant execute on function public.save_supplier_order(jsonb),public.receive_supplier_order(jsonb) to authenticated;
-- Install the identity guard as well when product_tags.sql was run first.
do $$ begin
 if to_regprocedure('public.guard_named_supplier_order()') is not null then
  drop trigger if exists named_supplier_products on public.supplier_orders;
  create trigger named_supplier_products before insert or update of lines on public.supplier_orders for each row execute function public.guard_named_supplier_order();
 end if;
end $$;
commit;
