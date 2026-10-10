import test from 'node:test';
import assert from 'node:assert/strict';
import {yearlyPubAverages,pubYearGraph,pubYears} from '../site/pub-year.js';
const now=new Date('2026-10-10T12:00:00Z');
const row=(date,quantity,category='QP',product='QP - Öl på tapp 50 cl')=>({date,quantity,gross_ore:quantity*100,category,product});
test('monthly arithmetic means, date-weighted annual means and explicit sample dates',()=>{
 const data={sales:[row('2026-01-07',1),row('2026-01-14',4),row('2026-01-21',10),row('2026-02-04',25),row('2026-01-09',8),row('2026-01-07',999,'QP-NPR')],events:[],imports:[]};
 const result=yearlyPubAverages(data,2026,'revenue',now);
 assert.equal(result.months[0].groups[0].average,5);
 assert.equal(result.groups[0].average,10);
 assert.equal(result.groups[0].count,4);
 assert.deepEqual(result.months[0].groups[0].dates,['2026-01-07','2026-01-14','2026-01-21']);
 assert.equal(result.months[2].groups[0].average,null);
 assert.match(pubYearGraph(result),/W 3 · F 1/);
 assert.deepEqual(pubYears(data),[2026]);
});
test('observed and marked bases stay distinct; only covered marked dates can supply genuine zeroes',()=>{
 const event=(date,kind='pub')=>({starts_at:date+'T16:00:00Z',kind,multiplier:1});
 const data={sales:[row('2026-01-07',10),row('2026-01-14',20),row('2026-01-21',100)],events:[event('2026-01-07'),event('2026-01-28'),event('2026-01-21','event')],imports:[{range_start:'2026-01-01',range_end:'2026-01-31'}]};
 assert.equal(yearlyPubAverages(data,2026,'drinks',now).groups[0].average,15);
 assert.equal(yearlyPubAverages(data,2026,'drinks',now,'marked').groups[0].average,5);
 assert.deepEqual(yearlyPubAverages(data,2026,'drinks',now,'marked').months[0].groups[0].dates,['2026-01-07','2026-01-28']);
 assert.equal(yearlyPubAverages({...data,events:[]},2026,'drinks',now,'marked').groups[0].average,null);
});
test('refunds affect sales; merchandise is not drink demand; today stays out',()=>{
 const data={sales:[row('2026-01-07',10),row('2026-01-07',-2),row('2026-01-07',20,'QP','QP - Märke'),row('2026-10-09',100)],events:[],imports:[]};
 assert.equal(yearlyPubAverages(data,2026,'revenue',now).groups[0].average,28);
 assert.equal(yearlyPubAverages(data,2026,'drinks',now).groups[0].average,8);
 assert.equal(yearlyPubAverages(data,2026,'drinks',new Date('2026-10-09T12:00:00Z')).groups[1].count,0);
 assert.throws(()=>yearlyPubAverages(data,'oops'));
 assert.throws(()=>yearlyPubAverages(data,2026,'attendance'));
});
