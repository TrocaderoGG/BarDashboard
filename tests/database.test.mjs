import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const admin='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222',outsider='33333333-3333-4333-8333-333333333333';
const event='44444444-4444-4444-8444-444444444444',requestId='55555555-5555-4555-8555-555555555555';
test('PostgreSQL authorization and stock/request transactions',async t=>{
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$; create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on all functions in schema auth to authenticated,anon;`);
  await db.exec(await readFile('supabase/schema.sql','utf8'));
  await db.exec(await readFile('supabase/catalog.sql','utf8'));
  await db.exec(`insert into auth.users values('${admin}'),('${member}'),('${outsider}'); insert into public.members values('admin@example.org','admin',true),('member@example.org','member',true); insert into public.events(id,name,starts_at,multiplier) values('${event}','Test event','2099-10-20T16:00:00Z',1);`);
  const login=async(id,email)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,email})]);await db.exec('set role authenticated');};
  const rpc=async(name,payload)=>(await db.query(`select public.${name}($1::jsonb) as result`,[JSON.stringify(payload)])).rows[0].result;
  const request={id:requestId,requester_name:'Org team',event_name:'Test event',event_date:'2099-10-20',guests:40,lines:[{product_id:'guinness',quantity:24}],notes:'4 hours'};
  await t.test('anonymous readers cannot fetch private tables or execute submission',async()=>{
    await db.exec('set role anon');await assert.rejects(db.query('select * from public.sales_daily'),/permission denied/);await assert.rejects(rpc('submit_request',request),/permission denied/);
  });
  await t.test('signed-in outsiders still cannot read organization data or submit',async()=>{
    await login(outsider,'outsider@example.org');assert.equal((await db.query('select * from public.products')).rows.length,0);await assert.rejects(rpc('submit_request',request),/Membership required/);
  });
  await t.test('members submit durable idempotent requests without stock privileges',async()=>{
    await login(member,'member@example.org');assert.equal((await db.query('select * from public.products')).rows.length,17);
    assert.equal(await rpc('submit_request',request),requestId);assert.equal(await rpc('submit_request',request),requestId);
    assert.equal((await db.query('select * from public.order_requests')).rows.length,1);
    await assert.rejects(rpc('submit_request',{...request,guests:45}),/different details/);
    await assert.rejects(rpc('save_count',{id:crypto.randomUUID(),counted_at:new Date().toISOString(),lines:[{product_id:'guinness',quantity:24}]}),/Barmaster access/);
    await assert.rejects(db.exec("update public.members set role='admin'"),/permission denied/);
    await assert.rejects(db.exec("update public.order_requests set status='approved'"),/permission denied/);
    await assert.rejects(rpc('import_sales_admin',{}),/permission denied/);
  });
  await t.test('malformed requests cannot bypass browser checks',async()=>{
    for(const change of [{guests:1.5},{guests:0},{event_date:'2020-01-01'},{lines:[{product_id:'guinness',quantity:1.5}]},{lines:[{product_id:'missing',quantity:2}]},{lines:[{product_id:'cider',quantity:2},{product_id:'cider',quantity:3}]}]) await assert.rejects(rpc('submit_request',{...request,id:crypto.randomUUID(),...change}));
  });
  await t.test('organizers can revise their own request after feedback',async()=>{
    const draft={...request,id:crypto.randomUUID()};await rpc('submit_request',draft);
    await login(admin,'admin@example.org');await rpc('review_request',{id:draft.id,status:'changes_requested',note:'Please reduce the quantity'});
    await assert.rejects(rpc('revise_request',{...draft,guests:45}),/Only your requests/);
    await login(member,'member@example.org');assert.equal(await rpc('revise_request',{...draft,guests:45}),draft.id);
    assert.equal((await db.query('select status from public.order_requests where id=$1',[draft.id])).rows[0].status,'pending');
  });
  await t.test('other members cannot read names or notes, but can read approved product demand',async()=>{
    await db.exec('reset role');await db.exec("insert into public.members values('other@example.org','member',true)");await login(outsider,'other@example.org');assert.equal((await db.query('select * from public.order_requests')).rows.length,0);
    await login(admin,'admin@example.org');await rpc('review_request',{id:requestId,status:'approved',event_id:event,note:'Approved for event'});
    await login(outsider,'other@example.org');const demand=(await db.query('select public.approved_demand() as data')).rows[0].data;
    assert.deepEqual(demand,[{event_id:event,status:'approved',lines:[{product_id:'guinness',quantity:24}]}]);assert.equal((await db.query('select * from public.order_requests')).rows.length,0);
  });
  await t.test('admin delivery reference is duplicate-safe and counts are idempotent',async()=>{
    await login(admin,'admin@example.org');const count={id:crypto.randomUUID(),counted_at:new Date().toISOString(),lines:[{product_id:'guinness',quantity:12}]};await rpc('save_count',count);await rpc('save_count',count);assert.equal((await db.query('select * from public.stock_counts')).rows.length,1);
    const delivery={id:crypto.randomUUID(),reference:'QP-TEST-01',kind:'delivery',occurred_at:new Date().toISOString(),lines:[{product_id:'guinness',quantity:24}]};await rpc('record_movement',delivery);await rpc('record_movement',delivery);await assert.rejects(rpc('record_movement',{...delivery,id:crypto.randomUUID()}),/already received/);
    assert.equal((await db.query('select * from public.stock_movements')).rows.length,1);
  });
  await t.test('kegs enforce seven slots, fridge capacity and 48 hours',async()=>{
    const slots=Array.from({length:7},(_,i)=>({slot:i+1,state:'empty',glasses:0,chilled_since:null}));
    const payload={id:crypto.randomUUID(),kegs:slots};await rpc('save_kegs',payload);assert.equal((await db.query("select quantity from public.stock_counts where product_id='tap'")).rows[0].quantity,'0');
    slots[0]={slot:1,state:'cold',glasses:50,chilled_since:new Date().toISOString()};await assert.rejects(rpc('save_kegs',{...payload,id:crypto.randomUUID()}),/48 hours/);
    await assert.rejects(rpc('save_kegs',{id:crypto.randomUUID(),kegs:slots.slice(0,6)}),/seven unique/);
  });
  await t.test('revoking membership takes effect despite a still-valid login token',async()=>{
    await db.exec('reset role');await db.exec("update public.members set active=false where email='member@example.org'");await login(member,'member@example.org');assert.equal((await db.query('select * from public.order_requests')).rows.length,0);await assert.rejects(rpc('submit_request',{...request,id:crypto.randomUUID()}),/Membership required/);
  });
  await t.test('trusted CSV import reconciles, is idempotent and rejects overlapping coverage',async()=>{
    await db.exec('reset role');
    const payload={meta:{id:'test-file',filename:'test.csv',range_start:'2026-01-01',range_end:'2026-01-31',first_sale:'2026-01-14',last_sale:'2026-01-14',source_rows:1,included_rows:1,excluded_rows:0,unclassified_rows:0,refund_rows:0,gross_ore:7000,quantity:2},rows:[{date:'2026-01-14',category:'QP',product:'Beer',quantity:2,gross_ore:7000,source_rows:1}]};
    assert.equal(await rpc('import_sales_admin',payload),true);assert.equal(await rpc('import_sales_admin',payload),false);
    await assert.rejects(rpc('import_sales_admin',{...payload,meta:{...payload.meta,id:'overlap'}}),/overlaps/);
    assert.equal((await db.query('select sum(gross_ore) total from public.sales_daily')).rows[0].total,'7000');
  });
  await t.test('private purchase import reconciles and cannot change stock or duplicate history',async()=>{
    await db.exec('reset role');
    await db.exec(await readFile('supabase/purchases.sql','utf8'));
    await db.exec(await readFile('supabase/purchases.sql','utf8'));
    const purchase={id:'purchase-test',supplier:'Spendrups',invoice_number:'test',invoice_date:'2026-09-16',date:'2026-09-15',order_reference:'QP20260913',supplier_order:'test-order',delivery_number:'test-delivery',source_url:'https://drive.google.com/file/d/test/view',source_file:'test.pdf',status:'qp',issues:[],net_ore:10000,printed_net_ore:10000,lines:[{sku:'beer',description:'Beer',quantity:1,unit:'KLI',pack_size:null,unit_net_ore:10000,net_ore:10000,kind:'goods'}]};
    const before=(await db.query('select count(*) from public.stock_movements')).rows[0].count;
    assert.equal(await rpc('import_purchases_admin',[purchase]),1);
    assert.equal(await rpc('import_purchases_admin',[purchase]),0);
    await assert.rejects(rpc('import_purchases_admin',[{...purchase,id:'bad',net_ore:10001}]),/reconcile/);
    await assert.rejects(rpc('import_purchases_admin',[{...purchase,id:'unknown',status:'review'}]),/Unreviewed/);
    await assert.rejects(rpc('import_purchases_admin',[{...purchase,lines:[{...purchase.lines[0],description:'Changed'}]}]),/differs/);
    assert.equal((await db.query('select count(*) from public.stock_movements')).rows[0].count,before);
    await db.exec('set role anon');await assert.rejects(db.query('select * from public.purchase_orders'),/permission denied/);
    await login(admin,'admin@example.org');assert.equal((await db.query('select * from public.purchase_orders')).rows.length,1);
    await assert.rejects(rpc('import_purchases_admin',[purchase]),/permission denied/);
    await login(member,'member@example.org');assert.equal((await db.query('select * from public.purchase_orders')).rows.length,0);
  });
  await db.close();
});
