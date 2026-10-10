import test from 'node:test';
import assert from 'node:assert/strict';
import {yearlyPubAverages,pubYearGraph,pubYears,smoothPath} from '../site/pub-year.js';
const now=new Date('2026-10-10T12:00:00Z');
const row=(date,quantity,category='QP',product='QP - Öl på tapp 50 cl')=>({date,quantity,gross_ore:quantity*100,category,product});
test('monthly arithmetic means, date-weighted annual means and explicit sample dates',()=>{
 const data={sales:[row('2026-01-07',1),row('2026-01-14',4),row('2026-01-21',10),row('2026-02-04',25),row('2026-01-09',8),row('2026-01-07',999,'QP-NPR')],events:[],imports:[]};
 const result=yearlyPubAverages(data,2026,'revenue',now);
 assert.equal(result.months[0].groups[0].average,5);
 assert.equal(result.months[0].groups[0].low,1);
 assert.equal(result.months[0].groups[0].high,10);
 assert.deepEqual(result.months[0].groups[0].samples[1],{date:'2026-01-14',value:4});
 assert.equal(result.months[0].groups[1].low,null);
 assert.equal(result.groups[0].average,10);
 assert.equal(result.groups[0].count,4);
 assert.deepEqual(result.months[0].groups[0].dates,['2026-01-07','2026-01-14','2026-01-21']);
 assert.equal(result.months[2].groups[0].average,null);
 assert.match(pubYearGraph(result),/W 3 · F 1\*/);
 assert.match(pubYearGraph(result),/Observed range: 1–10 SEK/);
 assert.match(pubYearGraph(result),/1 date · limited data/);
 assert.ok(!pubYearGraph(result).includes('stroke-dasharray'));
 assert.deepEqual(pubYears(data),[2026]);
});
test('smooth curves pass through averages and cannot exceed adjacent values',()=>{
 const points=[{x:0,y:10},{x:10,y:30},{x:20,y:5},{x:30,y:6},{x:40,y:6}];
 const path=smoothPath(points),curves=path.split(' C ').slice(1);
 assert.equal(curves.length,points.length-1);
 curves.forEach((curve,i)=>{
  const [x1,y1,x2,y2,x3,y3]=curve.replaceAll(',','').split(' ').map(Number),a=points[i],b=points[i+1];
  assert.deepEqual([x3,y3],[b.x,b.y]);
  for(let t=0;t<=1;t+=.01){const u=1-t,value=u**3*a.y+3*u*u*t*y1+3*u*t*t*y2+t**3*y3;assert.ok(value>=Math.min(a.y,b.y)-1e-8&&value<=Math.max(a.y,b.y)+1e-8);}
  assert.ok(x1>a.x&&x2<b.x);
 });
 assert.equal(smoothPath([]),'');assert.equal(smoothPath([{x:1,y:2}]),'M 1 2');
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
