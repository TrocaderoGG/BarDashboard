-- Run after schema.sql, catalog.sql and inventory.sql. Additive and repeatable.
-- Keeps generic legacy IDs/counts/orders for history; only named variants remain active.
begin;
update public.products set definition=definition||'{"brand": "Norrlands Guld", "productType": "Beer", "flavour": "Export", "group": "Beer", "tagSchemaVersion": 2, "name": "Norrlands Guld Export · 30 L keg", "tags": []}'::jsonb,version=version+1 where id='tap' and not definition ? 'brand';
update public.products set definition=definition||'{"brand": "Mariestad", "productType": "Beer", "flavour": "Export", "group": "Beer", "tagSchemaVersion": 2, "name": "Mariestad Export · 50 cl bottle", "tags": []}'::jsonb,version=version+1 where id='beer50' and not definition ? 'brand';
update public.products set definition=definition||'{"brand": "Guinness", "productType": "Beer", "flavour": "Stout", "group": "Beer", "tagSchemaVersion": 2, "packAssumed": true, "tags": []}'::jsonb,version=version+1 where id='guinness' and not definition ? 'brand';
update public.products set definition=definition||'{"brand": "Smirnoff", "productType": "RTD", "flavour": "Ice", "group": "RTD", "tagSchemaVersion": 2, "name": "Smirnoff Ice · 27.5 cl bottle", "tags": []}'::jsonb,version=version+1 where id='smirnoff' and not definition ? 'brand';
update public.products set definition=definition||'{"brand": "Coca-Cola", "productType": "Soft drink", "flavour": "Original", "group": "Soft drink", "tagSchemaVersion": 2, "alcoholFree": true, "tags": []}'::jsonb,version=version+1 where id='cola' and not definition ? 'brand';
update public.products set definition=definition||'{"brand": "Coca-Cola", "productType": "Soft drink", "flavour": "Zero", "group": "Soft drink", "tagSchemaVersion": 2, "alcoholFree": true, "tags": []}'::jsonb,version=version+1 where id='colazero' and not definition ? 'brand';
update public.products set definition=definition||'{"brand": "Fanta", "productType": "Soft drink", "flavour": "Original", "group": "Soft drink", "tagSchemaVersion": 2, "alcoholFree": true, "tags": []}'::jsonb,version=version+1 where id='fanta' and not definition ? 'brand';
update public.products set definition=definition||'{"brand": "Fanta", "productType": "Soft drink", "flavour": "Zero", "group": "Soft drink", "tagSchemaVersion": 2, "alcoholFree": true, "tags": []}'::jsonb,version=version+1 where id='fantazero' and not definition ? 'brand';
update public.products set definition=definition||'{"brand": "Sprite", "productType": "Soft drink", "flavour": "Original", "group": "Soft drink", "tagSchemaVersion": 2, "alcoholFree": true, "tags": []}'::jsonb,version=version+1 where id='sprite' and not definition ? 'brand';
update public.products set definition=definition||'{"brand": "Sprite", "productType": "Soft drink", "flavour": "Zero", "group": "Soft drink", "tagSchemaVersion": 2, "alcoholFree": true, "tags": []}'::jsonb,version=version+1 where id='spritezero' and not definition ? 'brand';
update public.products set definition=definition||'{"brand": "Red Bull", "productType": "Energy drink", "flavour": "Original", "group": "Energy drink", "tagSchemaVersion": 2, "alcoholFree": true, "tags": []}'::jsonb,version=version+1 where id='redbull' and not definition ? 'brand';
update public.products set definition=definition||'{"brand": "Red Bull", "productType": "Energy drink", "flavour": "Sugarfree", "group": "Energy drink", "tagSchemaVersion": 2, "alcoholFree": true, "tags": []}'::jsonb,version=version+1 where id='redbullzero' and not definition ? 'brand';
update public.products set definition=definition||'{"archived":true,"unverifiedIdentity":true,"tagSchemaVersion":2}'::jsonb,version=version+1
where coalesce(definition->>'brand','')='' and definition->>'name' in ('Beer · 33 cl','Cider · 33 cl','Alcohol-free beer / cider','Soft drinks · 50 cl PET','Sparkling wine') and not coalesce((definition->>'unverifiedIdentity')::boolean,false);
-- Previously created explicit Briska variants keep their own IDs and counts.
update public.products set definition=definition||jsonb_build_object('brand','Briska','productType','Cider','group','Cider','tagSchemaVersion',2),version=version+1
where not definition ? 'brand' and lower(definition->>'family')='briska' and lower(definition->>'name') like 'briska%';
insert into public.products(id,definition) select 'briska-mango-can','{"family": "Briska Mango · 33 cl can", "flavour": "Mango", "location": "Storage", "shelf": 0, "archived": false, "kind": "seasonal", "reorder": false, "countMode": "pack", "sizeMl": 330, "_version": 1, "supplier": "Spendrups", "requestFactor": 1, "id": "briska-mango-can", "name": "Briska Mango · 33 cl can", "brand": "Briska", "productType": "Cider", "group": "Cider", "unit": "cans", "pack": 24, "rate": 0, "minimum": 0, "tagSchemaVersion": 2, "tags": [], "unverifiedIdentity": false, "packAssumed": false}'::jsonb where not exists(select 1 from public.products where lower(trim(definition->>'brand'))='briska' and lower(trim(definition->>'flavour'))='mango' and (definition->>'sizeMl')::numeric=330 and definition->>'unit'='cans' and not coalesce((definition->>'archived')::boolean,false)) on conflict(id) do nothing;
insert into public.products(id,definition) select 'briska-demi-sec-glass','{"family": "Briska Demi Sec · 33 cl glass", "flavour": "Demi Sec", "location": "Storage", "shelf": 0, "archived": false, "kind": "seasonal", "reorder": false, "countMode": "pack", "sizeMl": 330, "_version": 1, "supplier": "Spendrups", "requestFactor": 1, "id": "briska-demi-sec-glass", "name": "Briska Demi Sec · 33 cl glass", "brand": "Briska", "productType": "Cider", "group": "Cider", "unit": "bottles", "pack": 24, "rate": 0, "minimum": 0, "tagSchemaVersion": 2, "tags": [], "unverifiedIdentity": false, "packAssumed": false}'::jsonb where not exists(select 1 from public.products where lower(trim(definition->>'brand'))='briska' and lower(trim(definition->>'flavour'))='demi sec' and (definition->>'sizeMl')::numeric=330 and definition->>'unit'='bottles' and not coalesce((definition->>'archived')::boolean,false)) on conflict(id) do nothing;

-- Existing named custom products can be tagged in the editor without discarding history.
create unique index if not exists product_variant_identity on public.products (
 lower(trim(definition->>'brand')),lower(trim(definition->>'productType')),
 coalesce(nullif(lower(trim(definition->>'flavour')),''),lower(trim(definition->>'name'))),((definition->>'sizeMl')::numeric),(definition->>'unit'),coalesce((definition->>'alcoholFree')::boolean,false)
) where coalesce(definition->>'brand','')<>'' and not coalesce((definition->>'archived')::boolean,false);
create unique index if not exists product_supplier_code on public.products (lower(trim(definition->>'supplier')),lower(trim(definition->>'supplierSku')))
where coalesce(definition->>'supplierSku','')<>'' and not coalesce((definition->>'archived')::boolean,false);
create unique index if not exists product_barcode on public.products ((definition->>'barcode'))
where coalesce(definition->>'barcode','')<>'' and not coalesce((definition->>'archived')::boolean,false);

-- Keep the proven stock/version validation behind the new identity guard.
do $$ begin
 if to_regprocedure('public.save_product_inventory(jsonb)') is null then alter function public.save_product(jsonb) rename to save_product_inventory;end if;
 if to_regprocedure('public.finish_count_session_inventory(jsonb)') is null then alter function public.finish_count_session(jsonb) rename to finish_count_session_inventory;end if;
end $$;
revoke all on function public.save_product_inventory(jsonb),public.finish_count_session_inventory(jsonb) from public,anon,authenticated;

create or replace function public.save_product(payload jsonb) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare d jsonb=payload->'definition'; tag jsonb;v integer;type_label text;
begin
 perform public.require_admin();perform pg_advisory_xact_lock(hashtext('qp-stock'));
 if exists(select 1 from public.products where id=d->>'id' and coalesce((definition->>'unverifiedIdentity')::boolean,false)) then raise exception 'Create a new named variant; legacy counts do not identify a product';end if;
 if length(trim(coalesce(d->>'brand',''))) not between 1 and 100 then raise exception 'Enter the actual product brand';end if;
 type_label=d->>'productType';
 if type_label is null or type_label not in ('Beer','Cider','RTD','Soft drink','Energy drink','Spirit','Wine','Other') then raise exception 'Choose a valid product type';end if;
 if d->>'name' in ('Beer · 33 cl','Cider · 33 cl','Alcohol-free beer / cider','Soft drinks · 50 cl PET','Sparkling wine') then raise exception 'Use a specific product name instead of a generic sales label';end if;
 if jsonb_typeof(d->'alcoholFree') is distinct from 'boolean' or jsonb_typeof(d->'packAssumed') is distinct from 'boolean' then raise exception 'Confirm the product attributes';end if;
 if jsonb_typeof(d->'tags') is distinct from 'array' or jsonb_array_length(d->'tags')>12 then raise exception 'Use up to 12 additional tags';end if;
 for tag in select * from jsonb_array_elements(d->'tags') loop
  if jsonb_typeof(tag)<>'string' or length(trim(tag#>>'{}')) not between 1 and 40 then raise exception 'Tags must be 1–40 characters';end if;
 end loop;
 if length(coalesce(d->>'supplierSku',''))>100 or length(coalesce(d->>'barcode',''))>50 then raise exception 'Product codes are too long';end if;
 if coalesce(d->>'supplierSku','')<>'' and trim(coalesce(d->>'supplier',''))='' then raise exception 'Choose the supplier for this product code';end if;
 -- Location is fixed internally; users have one stock room. Old count details remain intact.
 d=d||jsonb_build_object('brand',trim(d->>'brand'),'name',trim(d->>'name'),'flavour',trim(coalesce(d->>'flavour','')),'group',type_label,'family',trim(d->>'brand'),'location','Storage','tagSchemaVersion',2,'unverifiedIdentity',false,
 'alcoholFree',case when type_label in ('Soft drink','Energy drink') then true else (d->>'alcoholFree')::boolean end);
 begin v=public.save_product_inventory(jsonb_set(payload,'{definition}',d));
 exception when unique_violation then raise exception 'This variant, supplier code or barcode already exists. Edit the existing product.';end;
 return v;
end;$$;

create or replace function public.finish_count_session(payload jsonb) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare item record;begin
 perform public.require_admin();perform pg_advisory_xact_lock(hashtext('qp-stock'));
 if not coalesce((payload->>'discard')::boolean,false) then
  for item in select p.definition,s.lines->p.id line from public.count_sessions s join public.products p on s.lines ? p.id where s.id=(payload->>'id')::uuid and s.status='draft' and s.owner_id=auth.uid() loop
   if coalesce((item.line->>'confirmed')::boolean,false) and coalesce((item.definition->>'packAssumed')::boolean,false) and (item.line->>'full')::numeric>0 then raise exception 'Confirm the pack size first, or count individual units';end if;
  end loop;
 end if;
 return public.finish_count_session_inventory(payload);
end;$$;

-- Applies to both new orders and edits, including calls made outside the browser.
create or replace function public.guard_named_supplier_order() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare line jsonb;p jsonb;begin
 if TG_OP='UPDATE' and new.lines is not distinct from old.lines then return new;end if;
 for line in select * from jsonb_array_elements(new.lines) loop
  select definition into p from public.products where id=line->>'product_id';
  if coalesce((p->>'archived')::boolean,false) or coalesce((p->>'unverifiedIdentity')::boolean,false) then raise exception 'Choose a verified named product';end if;
  if coalesce((p->>'packAssumed')::boolean,false) and (line->>'full')::numeric>0 then raise exception 'Confirm the pack size before ordering packs';end if;
 end loop;
 return new;
end;$$;
do $$ begin
 if to_regclass('public.supplier_orders') is not null then
  drop trigger if exists named_supplier_products on public.supplier_orders;
  create trigger named_supplier_products before insert or update of lines on public.supplier_orders for each row execute function public.guard_named_supplier_order();
 end if;
end $$;
create or replace function public.catalog_tags_ready() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select public.is_member()$$;
revoke all on function public.save_product(jsonb),public.finish_count_session(jsonb),public.catalog_tags_ready(),public.guard_named_supplier_order() from public,anon;
grant execute on function public.save_product(jsonb),public.finish_count_session(jsonb),public.catalog_tags_ready() to authenticated;
commit;
