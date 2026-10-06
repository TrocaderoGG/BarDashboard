import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOG as seed} from '../scripts/catalog-seed.mjs';
import {setCatalog,PRODUCT} from '../site/catalog.js';
import {forecasts,stockFor,eventDemand,validateRequest,requestSummary,aggregateSales} from '../site/model.js';
setCatalog(seed);
const now=new Date('2026-10-06T12:00:00Z');
const count={product_id:'guinness',quantity:24,counted_at:'2026-10-01T12:00:00Z'};
test('counts supersede earlier deliveries and past events; CSV never depletes stock',()=>{
  const data={counts:[count],movements:[{product_id:'guinness',quantity:100,occurred_at:'2026-09-30T12:00:00Z'},{product_id:'guinness',quantity:24,occurred_at:'2026-10-02T12:00:00Z'},{product_id:'guinness',quantity:-2,occurred_at:'2026-10-03T12:00:00Z'}],events:[{id:'x',starts_at:'2026-10-04T16:00:00Z',multiplier:1}],sales:[{quantity:500}]};
  assert.equal(stockFor(PRODUCT.guinness,data,now).quantity,24.3);
  data.counts.push({...count,quantity:20,counted_at:'2026-10-05T12:00:00Z'});
  assert.equal(stockFor(PRODUCT.guinness,data,now).quantity,20);
});
test('unknown stock remains unknown; order suggestions cannot invent a count',()=>{
  assert.ok(forecasts({events:[]},now).every(p=>p.quantity===null&&p.packs===null));
});
test('packs round upward and caps/occupied partial kegs limit ordering',()=>{
  const data={counts:[{product_id:'tap',quantity:10,counted_at:now.toISOString()},{product_id:'redbull',quantity:4,counted_at:now.toISOString()}],events:[{id:'a',starts_at:'2026-10-07T16:00:00Z',multiplier:2.5}],kegs:Array.from({length:7},(_,i)=>({state:i===0?'empty':'warm'}))};
  const f=forecasts(data,now);const tap=f.find(p=>p.id==='tap'),red=f.find(p=>p.id==='redbull');
  assert.equal(tap.wanted,5);assert.equal(tap.packs,1);assert.equal(tap.blocked,true);
  assert.equal(red.wanted,1);assert.equal(red.packs,0);assert.equal(red.blocked,true);
});
test('approved requests are summed, pending requests ignored, event demand uses max not addition',()=>{
  const event={id:'e',multiplier:1};
  const req=[{event_id:'e',status:'approved',lines:[{product_id:'guinness',quantity:24}]},{event_id:'e',status:'pending',lines:[{product_id:'guinness',quantity:100}]}];
  assert.equal(eventDemand(event,PRODUCT.guinness,req),24);
  req.push({event_id:'e',status:'approved',lines:[{product_id:'guinness',quantity:12}]});
  assert.equal(eventDemand(event,PRODUCT.guinness,req),36);
  assert.equal(eventDemand(event,PRODUCT.beer33,req),5.4);
});
test('cancelled openings do not deduct stock or influence orders',()=>{
  const data={counts:[count],events:[{id:'x',starts_at:'2026-10-04T16:00:00Z',multiplier:3,cancelled:true},{id:'y',starts_at:'2026-10-07T16:00:00Z',multiplier:3,cancelled:true}]};
  const p=forecasts(data,now).find(p=>p.id==='guinness');assert.equal(p.quantity,24);assert.equal(p.demand,0);assert.equal(p.packs,0);
});
test('request validation enforces whole quantities, dates, customers and no duplicate products',()=>{
  const valid={event_name:'Gasque',event_date:'2026-10-20',requester_name:'Organizers',guests:50,lines:[{product_id:'tap',quantity:2}]};
  assert.equal(validateRequest(valid,'2026-10-06').guests,50);
  for(const change of [{event_date:'2026-02-30'},{event_date:'2026-10-01'},{guests:0},{guests:1.5},{lines:[{product_id:'tap',quantity:-1}]},{lines:[{product_id:'tap',quantity:1.5}]},{lines:[{product_id:'tap',quantity:1},{product_id:'tap',quantity:2}]}])assert.throws(()=>validateRequest({...valid,...change},'2026-10-06'));
  assert.deepEqual(requestSummary(valid.lines,50),{servings:100,perGuest:2,flagged:false});
});
test('history filtering and negative refund rows reconcile without multiplying line revenue by quantity',()=>{
  const rows=[{date:'2026-10-01',category:'QP',product:'Beer',quantity:3,gross_ore:10500},{date:'2026-10-02',category:'QP',product:'Beer',quantity:-1,gross_ore:-3500},{date:'2026-09-01',category:'QP',product:'Beer',quantity:4,gross_ore:14000}];
  const stats=aggregateSales(rows,'2026-10-01','2026-10-03','QP');assert.equal(stats.quantity,2);assert.equal(stats.revenue,7000);
});
