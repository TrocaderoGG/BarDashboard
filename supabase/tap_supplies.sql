-- Additive, repeatable. No stock quantities are seeded.
begin;
alter table public.keg_slots add column if not exists version integer not null default 1;
create or replace function public.bump_keg_version() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin new.version:=old.version+1;return new;end; $$;
drop trigger if exists keg_version on public.keg_slots;
create trigger keg_version before update on public.keg_slots for each row execute function public.bump_keg_version();
create or replace function public.save_kegs_checked(payload jsonb) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$ begin
 perform public.require_admin();perform pg_advisory_xact_lock(hashtext('qp-stock'));
 if exists(select 1 from public.stock_counts where batch_id=(payload->>'id')::uuid) then return true;end if;
 if jsonb_array_length(payload->'kegs')<>7 then raise exception 'Provide all seven keg slots';end if;
 if exists(select 1 from jsonb_array_elements(payload->'kegs') k left join public.keg_slots s on s.slot=(k->>'slot')::integer where s.slot is null or (k->>'version')::integer is distinct from s.version) then raise exception 'Kegs changed since you opened the count. Reopen before saving.';end if;
 return public.save_kegs(payload);
end; $$;
revoke all on function public.save_kegs_checked(jsonb) from public,anon;
grant execute on function public.save_kegs_checked(jsonb) to authenticated;
create table if not exists public.internal_supplies (
 id text primary key, name text not null check(length(trim(name)) between 1 and 120),
 "full" integer not null check("full" between 0 and 1000), in_use integer not null check(in_use between 0 and 1000), empty integer not null check(empty between 0 and 1000),
 version integer not null default 1, counted_at timestamptz not null default now()
);
alter table public.internal_supplies enable row level security;
drop policy if exists admin_internal_supplies on public.internal_supplies;
create policy admin_internal_supplies on public.internal_supplies for select to authenticated using(public.is_admin());
grant select on public.internal_supplies to authenticated;
create or replace function public.save_internal_supply(payload jsonb) returns integer language plpgsql security definer set search_path=public,pg_temp as $$ declare current_version integer;next_version integer;begin
 perform public.require_admin();perform pg_advisory_xact_lock(hashtext('qp-stock'));
 if payload->>'id' is null or length(payload->>'id') not between 1 and 100 then raise exception 'Invalid supply identity';end if;
 select version into current_version from public.internal_supplies where id=payload->>'id';
 if coalesce(current_version,0) is distinct from (payload->>'version')::integer then raise exception 'Supply count changed. Reopen before saving.';end if;
 if exists(select 1 from jsonb_each(payload) x where x.key in ('full','in_use','empty') and (x.value::text::numeric<>trunc(x.value::text::numeric))) then raise exception 'Count whole cylinders';end if;
 next_version:=coalesce(current_version,0)+1;
 insert into public.internal_supplies(id,name,"full",in_use,empty,version,counted_at) values(payload->>'id',trim(payload->>'name'),(payload->>'full')::integer,(payload->>'in_use')::integer,(payload->>'empty')::integer,next_version,now())
 on conflict(id) do update set name=excluded.name,"full"=excluded."full",in_use=excluded.in_use,empty=excluded.empty,version=excluded.version,counted_at=excluded.counted_at;
 perform public.audit('internal_supply_count',payload);return next_version;
end; $$;
revoke all on function public.save_internal_supply(jsonb) from public,anon;
grant execute on function public.save_internal_supply(jsonb) to authenticated;
commit;
