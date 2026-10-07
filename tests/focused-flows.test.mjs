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
const api=await import('../site/api.js');
const {openInventory}=await import('../site/inventory.js');
const {openDeliveries}=await import('../site/deliveries.js');
test('selected count resumes and publishes only confirmed products',async()=>{
 const before=await api.loadData();await openInventory({refresh:async()=>{},kegs:()=>{}});
 assert.ok(!host.innerHTML.includes('data-id="cola"'));
 await host.click('category',{category:'Soft drinks'});await host.click('select',{id:'cola'});await host.click('select',{id:'fanta'});
 await host.click('start');assert.match(host.innerHTML,/1 \/ 2/);
 await host.click('step',{key:'full',delta:'1'});
 await host.click('close');await openInventory({refresh:async()=>{},kegs:()=>{}});await host.click('start');
 assert.match(host.innerHTML,/20 cans/);
 await host.click('confirm');await host.click('next');
 assert.match(host.innerHTML,/1 products confirmed/);await host.click('publish');await host.click('close');
 const after=await api.loadData();assert.equal(after.counts.length,before.counts.length+1);
 assert.equal(after.counts.at(-1).product_id,'cola');assert.equal(after.counts.at(-1).quantity,20);
 assert.equal(after.counts.filter(c=>c.product_id==='fanta').length,before.counts.filter(c=>c.product_id==='fanta').length);
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
