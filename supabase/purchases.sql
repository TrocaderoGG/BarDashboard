-- Additive migration. Run after schema.sql; never changes inventory.
begin;
create table if not exists public.purchase_orders (
  id text primary key,
  supplier text not null check (supplier in ('Spendrups','Martin & Servera')),
  invoice_number text not null,
  invoice_date date not null,
  order_reference text not null check (order_reference like '%QP%'),
  supplier_order text not null,
  delivery_number text,
  date date not null,
  source_url text not null check (source_url ~ '^https://drive[.]google[.]com/file/d/[A-Za-z0-9_-]+/view([?].*)?$'),
  source_file text not null,
  net_ore bigint not null,
  lines jsonb not null check (jsonb_typeof(lines)='array' and jsonb_array_length(lines)>0),
  imported_at timestamptz not null default now(),
  unique(supplier,invoice_number,supplier_order,date,order_reference)
);
alter table public.purchase_orders enable row level security;
drop policy if exists member_read on public.purchase_orders;
create policy member_read on public.purchase_orders for select to authenticated using (public.is_member());
revoke all on public.purchase_orders from public,anon,authenticated;
grant select on public.purchase_orders to authenticated;
create or replace function public.import_purchases_admin(payload jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; n integer:=0; old public.purchase_orders;
begin
  perform pg_advisory_xact_lock(hashtext('qp-purchase-import'));
  if jsonb_typeof(payload) is distinct from 'array' then raise exception 'Expected orders array'; end if;
  for item in select * from jsonb_array_elements(payload) loop
    if item->>'status' is distinct from 'qp' or coalesce(jsonb_array_length(item->'issues'),-1)<>0 then raise exception 'Unreviewed purchase'; end if;
    if (item->>'net_ore')::bigint is distinct from (item->>'printed_net_ore')::bigint or
       (select sum((l->>'net_ore')::bigint) from jsonb_array_elements(item->'lines') l) is distinct from (item->>'net_ore')::bigint then raise exception 'Purchase lines do not reconcile'; end if;
    select * into old from public.purchase_orders where id=item->>'id';
    if found then
      if old.net_ore<>(item->>'net_ore')::bigint or old.lines<>item->'lines' or
         old.order_reference<>item->>'order_reference' or old.supplier<>item->>'supplier' or
         old.invoice_number<>item->>'invoice_number' or old.date<>(item->>'date')::date or
         old.supplier_order<>item->>'supplier_order' then raise exception 'Existing purchase differs; reconcile before replacing'; end if;
      continue;
    end if;
    insert into public.purchase_orders(id,supplier,invoice_number,invoice_date,order_reference,supplier_order,delivery_number,date,source_url,source_file,net_ore,lines)
    values(item->>'id',item->>'supplier',item->>'invoice_number',(item->>'invoice_date')::date,item->>'order_reference',item->>'supplier_order',item->>'delivery_number',(item->>'date')::date,item->>'source_url',item->>'source_file',(item->>'net_ore')::bigint,item->'lines');
    n:=n+1;
  end loop;
  perform public.audit('purchase_import',jsonb_build_object('orders_added',n));
  return n;
end; $$;
revoke all on function public.import_purchases_admin(jsonb) from public,anon,authenticated;
grant execute on function public.import_purchases_admin(jsonb) to service_role;
commit;
