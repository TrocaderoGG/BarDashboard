import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {kegSummary,litresToServings} from '../site/keg-model.js';
test('physical keg estimates translate to conservative servings',()=>{
 assert.deepEqual(kegSummary([{state:'warm',glasses:50},{state:'cold',glasses:50},{state:'on_tap',glasses:25},{state:'empty',glasses:0}]),{full:2,opened:1,servings:125});
 assert.equal(litresToServings(15),25);assert.equal(litresToServings(30),50);assert.equal(litresToServings(0),0);
 assert.deepEqual(kegSummary([{state:'on_tap',glasses:50}]),{full:0,opened:1,servings:50});
 for(const invalid of ['',-1,31,'no'])assert.throws(()=>litresToServings(invalid));
});
test('tap supplies stay private, versioned and separate from drink stock',async()=>{
 const db=new PGlite(),user='11111111-1111-4111-8111-111111111111';
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;`);
 for(const file of ['schema.sql','catalog.sql','tap_supplies.sql','tap_supplies.sql'])await db.exec(await readFile('supabase/'+file,'utf8'));
 await db.exec(`insert into auth.users values('${user}');insert into public.members values('admin@example.org','admin',true),('member@example.org','member',true)`);
 const login=async email=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,email})]);await db.exec('set role authenticated');};
 const rpc=async(name,payload)=>(await db.query(`select public.${name}($1::jsonb) value`,[JSON.stringify(payload)])).rows[0].value;
 const gas={id:'tap-gas',name:'Biogon test cylinder',version:0,full:1,in_use:1,empty:2};
 await login('member@example.org');await assert.rejects(rpc('save_internal_supply',gas),/Barmaster/);
 await login('admin@example.org');assert.equal((await db.query('select * from public.internal_supplies')).rows.length,0);
 assert.equal(await rpc('save_internal_supply',gas),1);
 await assert.rejects(rpc('save_internal_supply',gas),/changed/);
 await assert.rejects(rpc('save_internal_supply',{...gas,version:1,full:-1}),/check constraint/);
 await assert.rejects(rpc('save_internal_supply',{...gas,version:1,full:1.5}),/whole cylinders/);
 assert.equal(await rpc('save_internal_supply',{...gas,version:1,full:0}),2);
 assert.equal((await db.query("select count(*) n from public.products where id='tap-gas'")).rows[0].n,0);
 assert.equal((await db.query('select count(*) n from public.stock_counts')).rows[0].n,0);
 const kegs=(await db.query('select * from public.keg_slots order by slot')).rows;
 const payload={id:crypto.randomUUID(),kegs};assert.equal(await rpc('save_kegs_checked',payload),true);
 // Retry is idempotent even though the versions have advanced.
 assert.equal(await rpc('save_kegs_checked',payload),true);
 await assert.rejects(rpc('save_kegs_checked',{...payload,id:crypto.randomUUID()}),/changed/);
 await login('member@example.org');assert.equal((await db.query('select * from public.internal_supplies')).rows.length,0);
 await assert.rejects(rpc('save_kegs_checked',{...payload,id:crypto.randomUUID()}),/Barmaster/);
 await db.exec('reset role;set role anon');await assert.rejects(rpc('save_internal_supply',gas),/permission denied/);
 await db.close();
});
