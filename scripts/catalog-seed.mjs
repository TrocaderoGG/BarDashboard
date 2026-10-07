import {normalizeProduct} from '../site/inventory-model.js';
import {KNOWN_IDENTITIES} from '../site/product-identity.js';
export const CATALOG = [
  { id: 'tap', name: 'Tap beer', group: 'Beer & cider', unit: 'glasses', pack: 50, rate: 75, minimum: 25, capacity: 350, requestUnit: '30 L kegs', requestFactor: 50, note: '50 usable glasses per keg · 7 keg slots' },
  { id: 'beer50', name: 'Beer · 50 cl', group: 'Beer & cider', unit: 'bottles', pack: 15, rate: 12.8, minimum: 5 },
  { id: 'beer33', name: 'Beer · 33 cl', group: 'Beer & cider', unit: 'bottles', pack: 24, rate: 5.4, minimum: 5 },
  { id: 'guinness', name: 'Guinness · 44 cl', group: 'Beer & cider', unit: 'cans', pack: 24, rate: 21.7, minimum: 8, supplier: 'Martin & Servera' },
  { id: 'cider', name: 'Cider · 33 cl', group: 'Beer & cider', unit: 'bottles', pack: 24, rate: 34.2, minimum: 12 },
  { id: 'smirnoff', name: 'Smirnoff Ice', group: 'Beer & cider', unit: 'bottles', pack: 24, rate: 7.3, minimum: 5 },
  { id: 'alcoholfree', name: 'Alcohol-free beer / cider', group: 'Alcohol-free', unit: 'bottles', pack: 24, rate: 2, minimum: 4, packAssumed: true },
  ...[['cola','Coca-Cola',5],['colazero','Coca-Cola Zero',4],['fanta','Fanta',3],['fantazero','Fanta Zero',2],['sprite','Sprite',4],['spritezero','Sprite Zero',3]].map(([id,name,rate]) => ({ id, name, group: 'Soft drinks', unit: 'cans', pack: 20, rate, minimum: 5, capacity: 40, note: 'Variant split is a planning assumption' })),
  ...[['redbull','Red Bull',4],['redbullzero','Red Bull Sugarfree',3]].map(([id,name,rate]) => ({ id, name, group: 'Soft drinks', unit: 'cans', pack: 24, rate, minimum: 4, capacity: 24, note: 'Includes estimated mixer use' })),
  { id: 'pet', name: 'Soft drinks · 50 cl PET', group: 'Soft drinks', unit: 'bottles', pack: 24, rate: 6, minimum: 4, note: '24 per Spendrups crate; M&S packs vary' },
  {id:'briska-mango-can',name:'Briska Mango · 33 cl can',brand:'Briska',productType:'Cider',flavour:'Mango',group:'Cider',unit:'cans',sizeMl:330,pack:24,rate:0,minimum:0,reorder:false,kind:'seasonal'},
  {id:'briska-demi-sec-glass',name:'Briska Demi Sec · 33 cl glass',brand:'Briska',productType:'Cider',flavour:'Demi Sec',group:'Cider',unit:'bottles',sizeMl:330,pack:24,rate:0,minimum:0,reorder:false,kind:'seasonal'},
  { id: 'sparkling', name: 'Sparkling wine', group: 'Wine', unit: 'bottles', pack: 1, rate: 0, minimum: 0, note: 'Event orders only; pack size needs confirmation' }
].map(p => normalizeProduct({ supplier: 'Spendrups', requestFactor: 1, ...p, ...(KNOWN_IDENTITIES[p.id]||{}),group:KNOWN_IDENTITIES[p.id]?.productType||p.group,tagSchemaVersion:2 }));
export const PRODUCT = Object.fromEntries(CATALOG.map(p => [p.id,p]));
