import { CATALOG, PRODUCT } from './catalog.js';
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const fmt = (n, digits=0) => n == null || !Number.isFinite(Number(n)) ? '—' : new Intl.NumberFormat('sv-SE', { maximumFractionDigits: digits }).format(n);
export function dateLabel(value, options={}) {
  return new Intl.DateTimeFormat('en-GB', { day:'numeric',month:'short',timeZone:'Europe/Stockholm',...options }).format(new Date(value.length===10 ? value+'T12:00:00Z' : value));
}
export function localDate(value) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date(value));
}
export function eventDemand(event, product, requests=[]) {
  const reserved = requests.filter(r=>r.status==='approved' && r.event_id===event.id).reduce((sum,r)=>sum + r.lines.filter(l=>l.product_id===product.id).reduce((s,l)=>s+l.quantity*(product.requestFactor||1),0),0);
  // An approved event request replaces the normal estimate only where it is larger.
  return Math.max(product.rate * Number(event.multiplier), reserved);
}
export function stockFor(product, data, at=new Date()) {
  const count = data.counts?.filter(c=>c.product_id===product.id && new Date(c.counted_at)<=at).sort((a,b)=>new Date(b.counted_at)-new Date(a.counted_at))[0];
  if(!count) return { quantity:null, raw:null, countedAt:null, used:0 };
  const start=new Date(count.counted_at);
  const movement=(data.movements||[]).filter(m=>m.product_id===product.id && new Date(m.occurred_at)>start && new Date(m.occurred_at)<=at).reduce((s,m)=>s+Number(m.quantity),0);
  const used=(data.events||[]).filter(e=>!e.cancelled && new Date(e.starts_at)>start && new Date(e.starts_at)<=at).reduce((s,e)=>s+eventDemand(e,product,data.approvedDemand||data.requests),0);
  const raw=Number(count.quantity)+movement-used;
  return {quantity:Math.max(0,raw),raw,countedAt:count.counted_at,used};
}
export function forecasts(data, at=new Date(), horizon=2) {
  const upcoming=(data.events||[]).filter(e=>!e.cancelled&&new Date(e.starts_at)>at).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  return CATALOG.map(base=>{
    const product={...base,...(data.settings?.[base.id]||{})};
    const stock=stockFor(product,data,at);
    const next=upcoming.slice(0,horizon);
    const demand=next.reduce((s,e)=>s+eventDemand(e,product,data.approvedDemand||data.requests),0);
    const needed=stock.quantity===null?null:Math.max(0,demand+product.minimum-stock.quantity);
    const wanted=needed===null?null:Math.ceil(needed/product.pack);
    let maxPacks=product.capacity==null?Infinity:Math.max(0,Math.floor((product.capacity-(stock.quantity||0))/product.pack));
    if(product.id==='tap' && data.kegs?.length) maxPacks=Math.min(maxPacks,data.kegs.filter(k=>k.state==='empty').length);
    const packs=wanted===null?null:Math.min(wanted,maxPacks);
    let remaining=stock.quantity,runout=null;
    if(remaining!=null) for(const event of upcoming) { remaining-=eventDemand(event,product,data.approvedDemand||data.requests); if(remaining<0) {runout=event.starts_at;break;} }
    return { ...product,...stock,demand,packs,wanted,runout,blocked:wanted!=null&&wanted>packs,coverage:stock.quantity!=null&&product.rate>0?stock.quantity/product.rate:null,status:stock.quantity===null?'Uncounted':stock.quantity<0.01?'Out of stock':packs>0||wanted>0?'To order':'Covered',upcoming:next };
  });
}
export function validateRequest(draft, now=today()) {
  if(!draft.event_name?.trim()||draft.event_name.length>120) throw Error('Enter an event name (up to 120 characters).');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.event_date)||Number.isNaN(Date.parse(draft.event_date+'T12:00:00Z'))||new Date(draft.event_date+'T12:00:00Z').toISOString().slice(0,10)!==draft.event_date||draft.event_date<now) throw Error('Choose today or a future event date.');
  if(!Number.isInteger(Number(draft.guests))||draft.guests<1||draft.guests>10000) throw Error('Expected customers must be a whole number between 1 and 10,000.');
  if(!draft.requester_name?.trim()||draft.requester_name.length>100) throw Error('Enter your name (up to 100 characters).');
  if(!Array.isArray(draft.lines)||!draft.lines.length||draft.lines.length>30) throw Error('Add between 1 and 30 products.');
  const seen=new Set();
  for(const line of draft.lines) {
    if(!PRODUCT[line.product_id]||seen.has(line.product_id)) throw Error('Choose each product only once.');
    if(!Number.isInteger(Number(line.quantity))||line.quantity<1||line.quantity>10000) throw Error('Enter whole quantities between 1 and 10,000.');
    seen.add(line.product_id);
  }
  if((draft.notes||'').length>2000) throw Error('Keep notes below 2,000 characters.');
  return {...draft, guests:Number(draft.guests),event_name:draft.event_name.trim(),requester_name:draft.requester_name.trim(),lines:draft.lines.map(l=>({...l,quantity:Number(l.quantity)}))};
}
export function requestSummary(lines, guests) {
  const servings=lines.reduce((s,l)=>s+Number(l.quantity||0)*(PRODUCT[l.product_id]?.requestFactor||1)*(l.product_id==='sparkling'?6:1),0);
  return { servings, perGuest:guests>0?servings/guests:0, flagged:guests>0 && servings/guests>4 };
}
export function aggregateSales(rows, from, to, category='all') {
  const filtered=rows.filter(r=>r.date>=from&&r.date<=to&&(category==='all'||r.category===category));
  const daily={},products={},categories={};
  for(const row of filtered) {
    const d=daily[row.date]??={date:row.date,quantity:0,revenue:0};d.quantity+=row.quantity;d.revenue+=row.gross_ore;
    const p=products[row.product]??={name:row.product,quantity:0,revenue:0};p.quantity+=row.quantity;p.revenue+=row.gross_ore;
    categories[row.category]=(categories[row.category]||0)+row.gross_ore;
  }
  return { rows:filtered,quantity:filtered.reduce((s,r)=>s+r.quantity,0),revenue:filtered.reduce((s,r)=>s+r.gross_ore,0),daily:Object.values(daily).sort((a,b)=>a.date.localeCompare(b.date)),products:Object.values(products).sort((a,b)=>b.quantity-a.quantity),categories };
}
