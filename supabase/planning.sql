-- Run after schema.sql. Existing opening estimates retain their previous behavior.
begin;
alter table public.events add column if not exists kind text not null default 'legacy' check(kind in ('legacy','pub','event'));
create or replace function public.save_event(payload jsonb) returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$ begin
  perform public.require_admin(); perform pg_advisory_xact_lock(hashtext('qp-stock'));
  if exists(select 1 from public.order_requests where event_id=(payload->>'id')::uuid and status='approved' and event_date<>((payload->>'starts_at')::timestamptz at time zone 'Europe/Stockholm')::date) then raise exception 'Approved requests are linked to this date. Resolve them before moving the opening.'; end if;
  insert into public.events(id,name,starts_at,multiplier,cancelled,kind) values((payload->>'id')::uuid,trim(payload->>'name'),(payload->>'starts_at')::timestamptz,(payload->>'multiplier')::numeric,coalesce((payload->>'cancelled')::boolean,false),coalesce(payload->>'kind','legacy'))
    on conflict(id) do update set name=excluded.name,starts_at=excluded.starts_at,multiplier=excluded.multiplier,cancelled=excluded.cancelled,kind=excluded.kind;
  perform public.audit('opening_saved',payload); return true;
end; $$;

revoke all on function public.save_event(jsonb) from public,anon;
grant execute on function public.save_event(jsonb) to authenticated;
create or replace function public.planning_ready() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select public.is_member()$$;
revoke all on function public.planning_ready() from public,anon;
grant execute on function public.planning_ready() to authenticated;
commit;
