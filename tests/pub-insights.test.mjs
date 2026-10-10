import test from 'node:test';
import assert from 'node:assert/strict';
import {pastMonthRange,pubComparison,customerScenario,drinkLabel,pubInsights} from '../site/pub-insights.js';
test('past month is thirty inclusive Stockholm dates across month, leap-year and timezone boundaries',()=>{
 assert.deepEqual(pastMonthRange(new Date('2026-10-07T12:00:00Z')),{from:'2026-09-08',to:'2026-10-07',category:'all'});
 assert.equal(pastMonthRange(new Date('2024-03-01T12:00:00Z')).from,'2024-02-01');
 assert.equal(pastMonthRange(new Date('2026-03-31T22:30:00Z')).to,'2026-04-01');
});
test('pub-session source requires all imports and complete 04:00 coverage, joining adjacent exports',()=>{
 const imports=[{id:'a',range_start:'2026-09-01',range_end:'2026-09-11'},{id:'b',range_start:'2026-09-12',range_end:'2026-09-30'}];
 const data={imports,pubImports:imports.map(i=>({id:i.id,cutoff_hour:4,time_zone:'Europe/Stockholm'})),pubSales:[row('2026-09-11','QP - Öl',10),row('2026-09-11','QP - Öl',20),row('2026-09-30','QP - Öl',100)],sales:[row('2026-09-11','QP - Öl',10)],events:[]};
 const result=pubComparison(data,range,now);assert.equal(result.sessionGrouped,true);assert.equal(result.groups[1].drinks.typical,30);
 assert.equal(result.groups[0].dates.length,0); // Sep 30 cannot be complete without Oct 1 coverage.
 assert.equal(pubComparison({...data,pubImports:data.pubImports.slice(0,1)},range,now).sessionGrouped,false);
 const beforeCutoff=pubComparison({...data,imports:[{...imports[0],range_end:'2026-09-30'}],pubImports:[data.pubImports[0]]},range,new Date('2026-09-12T00:30:00Z'));
 assert.equal(beforeCutoff.groups[1].dates.length,0);
});
const row=(date,product,quantity,gross_ore=quantity*3500,category='QP')=>({date,product,quantity,gross_ore,category});
const range={from:'2026-09-01',to:'2026-09-30',category:'all'},now=new Date('2026-10-01T12:00:00Z');
test('weekday demand includes refunds and per-date zero labels, excluding merchandise and special categories',()=>{
 const data={events:[],imports:[{range_start:'2026-09-01',range_end:'2026-09-30'}],sales:[row('2026-09-09','QP - Öl på tapp 50 cl',20),row('2026-09-09','QP - Öl på tapp 50 cl',-2,-7000),row('2026-09-09','QP - Märke',100),row('2026-09-09','QP mat - Billys',5),row('2026-09-16','QP - Cider',10),row('2026-09-11','QP - Öl på tapp 50 cl',60),row('2026-09-18','QP - Öl på tapp 50 cl',40),row('2026-09-11','QP - Öl på tapp 50 cl',500,100000,'QP-NPR')]};
 const result=pubComparison(data,range,now);assert.equal(result.basis,'observed');
 assert.deepEqual(result.groups[0].drinks,{typical:14,low:10,busy:18});assert.deepEqual(result.groups[1].drinks,{typical:50,low:40,busy:60});
 assert.equal(result.products.find(p=>p.label.includes('tapp')).wednesday.typical,9);assert.equal(result.products.find(p=>p.label.includes('Cider')).friday.typical,0);
 assert.equal(result.products.length,2);assert.ok(!drinkLabel('QP - Märke'));assert.ok(drinkLabel('QP - Alkfri cider/öl'));
 assert.equal(customerScenario(result.groups[0],''),null);assert.deepEqual(customerScenario(result.groups[1],2),{typical:25,busy:30});
 const html=pubInsights(data,range);assert.match(html,/Customer attendance is not recorded/);assert.ok(!html.includes('value="3"'));
 assert.match(pubInsights(data,{...range,category:'QP-NPR'}),/Choose QP/);
});
test('marked normal pubs include covered zero dates, while gaps, events, cancellations and partial today stay out',()=>{
 const event=(date,kind='pub',cancelled=false,multiplier=1)=>({starts_at:date+'T16:00:00Z',kind,cancelled,multiplier});
 const data={imports:[{range_start:'2026-09-01',range_end:'2026-09-12'},{range_start:'2026-09-20',range_end:'2026-09-30'}],events:[event('2026-09-09'),event('2026-09-16'),event('2026-09-23'),event('2026-09-11','event'),event('2026-09-25','pub',true),event('2026-09-30')],sales:[row('2026-09-09','QP - Öl Guinness',20),row('2026-09-11','QP - Öl Guinness',100),row('2026-09-25','QP - Öl Guinness',100),row('2026-09-30','QP - Öl Guinness',100)]};
 const result=pubComparison(data,range,new Date('2026-09-30T18:00:00Z'));assert.equal(result.basis,'marked');
 assert.deepEqual(result.groups[0].dates,['2026-09-09','2026-09-23']);assert.equal(result.groups[0].drinks.typical,10);
 assert.deepEqual(result.groups[1].dates,[]);assert.equal(result.groups[1].drinks.typical,null);assert.equal(customerScenario(result.groups[1],2),null);
});
