-- Additive, repeatable. Keeps calendar sales intact; no business data is seeded.
begin;
create table if not exists public.sales_session_imports (
 id text primary key references public.sales_imports(id),
 cutoff_hour integer not null check(cutoff_hour=4),
 time_zone text not null check(time_zone='Europe/Stockholm'),
 created_at timestamptz not null default now()
);
create table if not exists public.sales_sessions_daily (
 id bigint generated always as identity primary key,
 import_id text not null references public.sales_session_imports(id),
 date date not null, category text not null check(category in ('QP','QP-NPR','QP-VPR','QP-Pitbull','QP-Plåt')),
 product text not null, quantity numeric not null, gross_ore bigint not null,
 source_rows integer not null check(source_rows>0), unique(import_id,date,category,product)
);
create index if not exists sales_sessions_date on public.sales_sessions_daily(date,category);
alter table public.sales_session_imports enable row level security;
alter table public.sales_sessions_daily enable row level security;
drop policy if exists member_read on public.sales_session_imports;
create policy member_read on public.sales_session_imports for select to authenticated using(public.is_member());
drop policy if exists member_read on public.sales_sessions_daily;
create policy member_read on public.sales_sessions_daily for select to authenticated using(public.is_member());
revoke all on public.sales_session_imports,public.sales_sessions_daily from anon,authenticated;
grant select on public.sales_session_imports,public.sales_sessions_daily to authenticated;
revoke all on sequence public.sales_sessions_daily_id_seq from anon,authenticated;
create or replace function public.import_pub_sales_admin(payload jsonb) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare original public.sales_imports; line jsonb;
begin
 perform pg_advisory_xact_lock(hashtext('qp-sales-import'));
 select * into original from public.sales_imports where id=payload->>'import_id';
 if not found then raise exception 'Import the original calendar export first';end if;
 if (payload->>'cutoff_hour')::integer is distinct from 4 or payload->>'time_zone' is distinct from 'Europe/Stockholm' then raise exception 'Use 04:00 Europe/Stockholm';end if;
 if jsonb_typeof(payload->'rows') is distinct from 'array' or jsonb_array_length(payload->'rows')=0 then raise exception 'Provide session totals';end if;
 -- Reconcile every product/category and source-row count against the untouched original.
 if exists(
  with expected as (select category,product,sum(quantity) quantity,sum(gross_ore) gross_ore,sum(source_rows) source_rows from public.sales_daily where import_id=original.id group by category,product),
  received as (select category,product,sum(quantity) quantity,sum(gross_ore) gross_ore,sum(source_rows) source_rows from jsonb_to_recordset(payload->'rows') as r(category text,product text,quantity numeric,gross_ore bigint,source_rows integer) group by category,product)
  select 1 from expected e full join received r using(category,product)
  where e.quantity is distinct from r.quantity or e.gross_ore is distinct from r.gross_ore or e.source_rows is distinct from r.source_rows
 ) then raise exception 'Session totals do not reconcile with the original export';end if;
 if exists(select 1 from jsonb_array_elements(payload->'rows') r where (r->>'date')::date<original.range_start-1 or (r->>'date')::date>original.range_end) then raise exception 'Session outside original export coverage';end if;
 if exists(select 1 from public.sales_session_imports where id=original.id) then return false;end if;
 insert into public.sales_session_imports(id,cutoff_hour,time_zone) values(original.id,4,'Europe/Stockholm');
 for line in select * from jsonb_array_elements(payload->'rows') loop
  insert into public.sales_sessions_daily(import_id,date,category,product,quantity,gross_ore,source_rows)
  values(original.id,(line->>'date')::date,line->>'category',line->>'product',(line->>'quantity')::numeric,(line->>'gross_ore')::bigint,(line->>'source_rows')::integer);
 end loop;
 perform public.audit('sales_session_import',jsonb_build_object('import_id',original.id,'cutoff_hour',4,'time_zone','Europe/Stockholm'));
 return true;
end;$$;
revoke all on function public.import_pub_sales_admin(jsonb) from public,anon,authenticated;
grant execute on function public.import_pub_sales_admin(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
