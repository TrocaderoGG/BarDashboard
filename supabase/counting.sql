-- Run after inventory.sql and product_tags.sql. Additive; preserves all counts and drafts.
begin;
alter table public.products add column if not exists stock_version bigint not null default 0;
create or replace function public.bump_stock_version() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
 perform pg_advisory_xact_lock(hashtext('qp-stock'));
 if TG_OP in ('UPDATE','DELETE') then update public.products set stock_version=stock_version+1 where id=old.product_id;end if;
 if TG_OP='INSERT' or (TG_OP='UPDATE' and new.product_id is distinct from old.product_id) then update public.products set stock_version=stock_version+1 where id=new.product_id;end if;
 if TG_OP='DELETE' then return old;end if;return new;
end;$$;
drop trigger if exists stock_count_version on public.stock_counts;
create trigger stock_count_version after insert or update or delete on public.stock_counts for each row execute function public.bump_stock_version();
drop trigger if exists stock_movement_version on public.stock_movements;
create trigger stock_movement_version after insert or update or delete on public.stock_movements for each row execute function public.bump_stock_version();
revoke all on function public.bump_stock_version() from public,anon,authenticated;
create or replace function public.save_product_count(payload jsonb) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.products;s public.count_sessions;line jsonb:=payload->'line';v integer;begin
 perform public.require_admin();perform pg_advisory_xact_lock(hashtext('qp-stock'));
 select * into s from public.count_sessions where id=(payload->>'id')::uuid;
 if found then
  if s.owner_id<>auth.uid() then raise exception 'This count belongs to another person';end if;
  if s.status='published' and s.lines ? (payload->>'product_id') and (select count(*) from jsonb_object_keys(s.lines))=1 then return true;end if;
  if s.status<>'draft' or (select count(*) from jsonb_object_keys(s.lines))<>1 or not s.lines ? (payload->>'product_id') then raise exception 'Start a new single-product count';end if;
 end if;
 select * into p from public.products where id=payload->>'product_id';
 if not found or trim(coalesce(p.definition->>'brand',''))='' or p.id='tap' or coalesce((p.definition->>'archived')::boolean,false) or coalesce((p.definition->>'unverifiedIdentity')::boolean,false) then raise exception 'Choose an available named product';end if;
 if p.stock_version is distinct from (line->>'stockVersion')::bigint then raise exception 'Stock changed while you were counting. Start a fresh count to include the delivery or other count.';end if;
 if coalesce((p.definition->>'packAssumed')::boolean,false) and (line->>'full')::numeric>0 then raise exception 'Confirm the pack size first, or count individual units';end if;
 line:=line||jsonb_build_object('confirmed',true,'counted_at',now());
 v:=public.save_count_session(jsonb_build_object('id',payload->'id','revision',payload->'revision','lines',jsonb_build_object(p.id,line)));
 perform public.finish_count_session(jsonb_build_object('id',payload->'id','revision',v));
 if exists(select 1 from public.stock_counts where batch_id=(payload->>'id')::uuid and product_id=p.id and quantity=0) and not coalesce((line->>'zeroConfirmed')::boolean,false) then raise exception 'Use Out of stock to confirm a zero count';end if;
 -- A newly saved physical count supersedes this owner's older unfinished amount.
 update public.count_sessions set lines=lines-p.id,revision=revision+1,status=case when (select count(*) from jsonb_object_keys(lines))=1 then 'discarded' else 'draft' end,updated_at=now()
 where owner_id=auth.uid() and status='draft' and id<>(payload->>'id')::uuid and lines ? p.id;
 return true;
end;$$;
revoke all on function public.save_product_count(jsonb) from public,anon;
grant execute on function public.save_product_count(jsonb) to authenticated;
commit;
