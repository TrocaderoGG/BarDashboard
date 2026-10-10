import test from 'node:test';
import assert from 'node:assert/strict';
import {previewData} from '../scripts/preview-data.mjs';
// Run actual event handlers against a minimal DOM host. Full visual checks require Chromium.
const state=previewData();
globalThis.location={hostname:'localhost'};globalThis.sessionStorage={getItem:()=>null};globalThis.fetch=async()=>({ok:true,json:async()=>structuredClone(state)});
let host;
class Dialog {
 constructor(){this.handlers={};this.inputs={};this.innerHTML='';}
 setAttribute(){} showModal(){} close(){} remove(){}
 addEventListener(event,fn){this.handlers[event]=fn;}
 querySelector(selector){if(selector==='#draft-status')return {set textContent(v){},get textContent(){return '';}};return this.inputs[selector]||null;}
 async click(action,data={},prefix='inv'){const target={dataset:{[prefix]:action,...data},disabled:false};await this.handlers.click({target:{closest:()=>target},stopPropagation(){}});}
}
globalThis.document={createElement:()=>{host=new Dialog();return host;},body:{append(){}}};
const api=await import('../site/api.js?v=6f6155099a19');
const {openInventory}=await import('../site/inventory.js');
const {openDeliveries}=await import('../site/deliveries.js');
test('a product opens directly, saves immediately and never reappears as unfinished',async()=>{
 const before=await api.loadData();await openInventory({refresh:async()=>{},kegs:()=>{}});
 await host.click('select',{id:'cola'},'counting');assert.match(host.innerHTML,/Save count/);assert.ok(!host.innerHTML.includes('Publish count'));
 await host.click('step',{key:'full',delta:'1'},'counting');
 await host.click('close',{},'counting');await openInventory({refresh:async()=>{},kegs:()=>{}});
 assert.match(host.innerHTML,/unfinished count/);assert.ok(!host.innerHTML.includes('data-amount="full"'));
 const draft=(await api.loadData()).countSessions.find(s=>s.status==='draft');
 await host.click('resume',{id:draft.id},'counting');assert.match(host.innerHTML,/20 cans/);
 await host.click('save',{},'counting');assert.match(host.innerHTML,/saved · 20 cans/);
 assert.ok(!host.innerHTML.includes('unfinished count'));assert.ok(!host.innerHTML.includes('data-amount="full"'));
 const after=await api.loadData();assert.equal(after.counts.length,before.counts.length+1);assert.equal(after.counts.at(-1).quantity,20);
 await host.click('select',{id:'cola'},'counting');assert.match(host.innerHTML,/value="0"/);assert.match(host.innerHTML,/Opening this counter does not change stock/);
 await host.click('zero',{},'counting');await host.click('save',{},'counting');assert.equal((await api.loadData()).counts.at(-1).quantity,0);
 await host.click('tag',{tag:'type:Soft drink'},'countpick');await host.click('guided',{},'counting');
 await host.click('step',{key:'full',delta:'1'},'counting');await host.click('save',{},'counting');assert.match(host.innerHTML,/1 saved/);
 const last=(await api.loadData()).counts.at(-1);await host.click('back',{},'counting');assert.match(host.innerHTML,/1 skipped/);
 assert.equal((await api.loadData()).counts.at(-1).id,last.id);await host.click('close',{},'counting');
 await openInventory({refresh:async()=>{},kegs:()=>{}});await host.click('select',{id:'cola'},'counting');await host.click('step',{key:'full',delta:'1'},'counting');await host.click('close',{},'counting');
 await api.write('record_movement',{id:crypto.randomUUID(),kind:'delivery',reference:'QP-stale-flow',occurred_at:new Date().toISOString(),lines:[{product_id:'cola',quantity:20}]});
 await openInventory({refresh:async()=>{},kegs:()=>{}});const stale=(await api.loadData()).countSessions.find(s=>s.status==='draft'&&s.lines.cola);
 await host.click('resume',{id:stale.id},'counting');assert.match(host.innerHTML,/Stock or product details changed/);assert.match(host.innerHTML,/data-counting="save" disabled/);
 await host.click('restart',{},'counting');assert.ok(!host.innerHTML.includes('Stock or product details changed'));await host.click('close',{},'counting');

});
test('supplier order becomes a focused receiving list with discrepancy checks',async()=>{
 await openDeliveries({refresh:async()=>{},mode:'order'});
 host.inputs['#delivery-reference']={value:'QP-flow-test'};
 host.inputs['#delivery-date']={value:'2026-10-13'};
 host.inputs['#delivery-supplier']={value:'Spendrups'};
 await host.click('category',{category:'Soft drinks'},'del');
 await host.click('select',{id:'cola'},'del');assert.match(host.innerHTML,/Full packs/);
 await host.click('step',{key:'full',delta:'1'},'del');await host.click('step',{key:'full',delta:'1'},'del');
 await host.click('confirm',{},'del');await host.click('save',{},'del');
 const order=(await api.loadData()).supplierOrders.at(-1);assert.equal(order.lines[0].quantity,40);
 await host.click('receive',{id:order.id},'del');assert.match(host.innerHTML,/Ordered: <strong>40 cans/);assert.match(host.innerHTML,/Count, then confirm/);
 await host.click('step',{key:'full',delta:'1'},'del');await host.click('confirm',{},'del');assert.match(host.innerHTML,/20 missing/);
 await host.click('finish',{},'del');assert.match(host.innerHTML,/Explain missing or extra items/);
 host.inputs['#delivery-note']={value:'One pack missing'};await host.click('finish',{},'del');assert.match(host.innerHTML,/Delivery recorded/);
 const after=await api.loadData();assert.equal(after.supplierOrders.at(-1).receipt.lines[0].difference,-20);assert.equal(after.movements.at(-1).quantity,20);
 await host.click('close',{},'del');
});
test('unplanned receiving tallies once and does not claim an order match',async()=>{
 await openDeliveries({refresh:async()=>{}});await host.click('unplanned',{},'del');
 host.inputs['#delivery-reference']={value:'QP-unplanned-flow'};host.inputs['#delivery-date']={value:'2026-10-13'};
 await host.click('select',{id:'fanta'},'del');await host.click('step',{key:'full',delta:'1'},'del');await host.click('confirm',{},'del');
 assert.match(host.innerHTML,/Confirm received delivery/);await host.click('save',{},'del');assert.match(host.innerHTML,/No saved order to compare/);
 const saved=(await api.loadData()).supplierOrders.at(-1);assert.equal(saved.receipt.lines[0].quantity,null);assert.equal(saved.receipt.lines[0].received,20);
 await host.click('close',{},'del');
});
