import test from 'node:test';import assert from 'node:assert/strict';
import {datedPlan,deliverySlot,orderCutoff,stockholmInstant,trendRate} from '../site/planning.js';
import {eventDemand} from '../site/model.js';
const p={id:'cola',name:'Cola',supplier:'Spendrups',pack:20,rate:20,minimum:0,capacity:40};
const now=new Date('2026-10-06T12:00:00Z');
const event=(id,date,kind='event')=>({id,name:id,starts_at:date+'T17:00:00Z',kind,multiplier:1});
test('pub consumption is additional to reservations while event-only demand uses requests',()=>{
 const request=[{status:'approved',event_id:'x',lines:[{product_id:'cola',quantity:30}]}];
 assert.equal(eventDemand(event('x','2026-10-16','pub'),p,request),50);
 assert.equal(eventDemand(event('x','2026-10-16'),p,request),30);
 assert.equal(eventDemand(event('x','2026-10-16'),p,[{...request[0],status:'pending'}]),0);
});
test('Sunday cutoff covers both Tuesday and Thursday, in Stockholm including DST',()=>{
 assert.equal(orderCutoff('2026-10-13').toISOString(),'2026-10-11T21:59:59.000Z');
 assert.equal(orderCutoff('2026-10-15').toISOString(),'2026-10-11T21:59:59.000Z');
 assert.equal(orderCutoff('2026-10-27').toISOString(),'2026-10-25T22:59:59.000Z');
 assert.equal(deliverySlot(p,event('x','2026-10-09'),now),null);
 assert.equal(deliverySlot({...p,supplier:'Martin & Servera'},event('x','2026-10-16'),now).date,'2026-10-15');
 assert.equal(deliverySlot({...p,supplier:'Martin & Servera'},event('x','2026-10-16'),now,'tuesday').date,'2026-10-13');
 assert.equal(deliverySlot({...p,id:'tap'},event('x','2026-10-14'),now),null);
});
test('chronological allocation protects pub stock, plans event top-ups and reports temporary capacity',()=>{
 const data={counts:[{product_id:'cola',quantity:30,counted_at:'2026-10-06T10:00:00Z'}],events:[event('pub','2026-10-14','pub'),event('party','2026-10-16')],approvedDemand:[{status:'approved',event_id:'party',lines:[{product_id:'cola',quantity:60}]}]};
 const plan=datedPlan([p],data,now)[0];assert.equal(plan.pubHold,20);assert.equal(plan.eventHold,60);assert.equal(plan.deliveries[0].quantity,60);assert.equal(plan.deliveries[0].date,'2026-10-13');assert.equal(plan.deliveries[0].balance,90);assert.equal(plan.temporaryExcess,50);
 assert.equal(datedPlan([p],{...data,counts:[]},now)[0].unknown,true);
 assert.equal(datedPlan([p],{...data,events:data.events.map(e=>({...e,cancelled:true}))},now)[0].deliveries.length,0);
});
test('pub rates use explicitly mapped labels and reference dates including covered zero dates',()=>{
 const product={...p,salesProduct:'QP Cola'},data={products:[product],events:[event('a','2026-01-07','pub'),event('b','2026-01-14','pub')],imports:[{range_start:'2026-01-01',range_end:'2026-01-31'}],sales:[{date:'2026-01-07',category:'QP',product:'QP Cola',quantity:20},{date:'2026-01-14',category:'QP-VPR',product:'QP Cola',quantity:100}]};
 assert.equal(trendRate(product,data).rate,10);data.products.push({...product,id:'zero'});assert.equal(trendRate(product,data),null);
});
