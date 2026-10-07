import {stockFor,localDate,eventDemand} from './model.js';
const DAY=86400000;
function shift(date,days){return new Date(Date.parse(date+'T12:00:00Z')+days*DAY).toISOString().slice(0,10);}
export function stockholmInstant(date,hour=23,minute=59,second=59){
 let guess=Date.parse(`${date}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:${String(second).padStart(2,'0')}Z`);
 for(let i=0;i<3;i++){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const shown=Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`),wanted=Date.parse(`${date}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:${String(second).padStart(2,'0')}Z`);
  guess+=wanted-shown;
 }return new Date(guess);
}
export function orderCutoff(deliveryDate){const weekday=new Date(deliveryDate+'T12:00:00Z').getUTCDay();return stockholmInstant(shift(deliveryDate,-weekday));}
export function supplierDays(supplier,choice='latest'){
 supplier=String(supplier||'').trim();
 if(supplier.toLowerCase()==='spendrups')return [2];
 if(/^(martin\s*&\s*servera|m\s*&\s*s)$/i.test(supplier))return choice==='tuesday'?[2]:choice==='thursday'?[4]:[2,4];
 return [];
}
export function deliverySlot(product,event,now,choice='latest'){
 const readyBy=new Date(new Date(event.starts_at)-(product.id==='tap'?48*3600000:0)),last=localDate(readyBy),today=localDate(now),days=supplierDays(product.supplier,choice);
 for(let i=0;i<28;i++){
  const date=shift(last,-i);if(date<today)break;
  if(days.includes(new Date(date+'T12:00:00Z').getUTCDay())&&orderCutoff(date)>now)return {date,cutoff:orderCutoff(date).toISOString(),readyBy:readyBy.toISOString(),arrivalNeedsConfirmation:date===last};
 }
 return null;
}
export function reservationUnits(event,product,requests){return requests.filter(r=>r.status==='approved'&&r.event_id===event.id).reduce((s,r)=>s+r.lines.filter(l=>l.product_id===product.id).reduce((sum,l)=>sum+Number(l.quantity)*(product.requestFactor||1),0),0);}
export function datedPlan(products,data,now=new Date(),choice='latest',days=56){
 const end=new Date(now.getTime()+days*DAY),events=data.events.filter(e=>!e.cancelled&&new Date(e.starts_at)>now&&new Date(e.starts_at)<=end).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)),requests=data.approvedDemand||data.requests||[];
 return products.filter(p=>!p.archived).map(base=>{
  const p={...base,...data.settings?.[base.id]},stock=stockFor(p,data,now),reserve=p.reorder===false?0:Number(p.minimum||0),deliveries=[],needs=[];
  if(stock.quantity===null){const needs=events.map(e=>{const reserved=reservationUnits(e,p,requests),demand=eventDemand(e,p,requests);return {reserved,pub:Math.max(0,demand-reserved)};});return {product:p,stock:null,needs:[],deliveries:[],unknown:true,pubHold:needs.reduce((s,n)=>s+n.pub,0),eventHold:needs.reduce((s,n)=>s+n.reserved,0),reserve};}
  let balance=stock.quantity;
  for(const event of events){
   const reserved=reservationUnits(event,p,requests),demand=eventDemand(event,p,requests);if(!demand)continue;
   const shortage=Math.max(0,demand+reserve-balance),packs=Math.ceil(shortage/p.pack),slot=packs?deliverySlot(p,event,now,choice):null;
   if(packs&&slot){deliveries.push({...slot,packs,quantity:packs*p.pack,event_id:event.id,event_name:event.name});balance+=packs*p.pack;}
   needs.push({event_id:event.id,name:event.name,starts_at:event.starts_at,kind:event.kind||'legacy',demand,reserved,pub:Math.max(0,demand-reserved),before:balance,after:balance-demand,packs,delivery:slot,uncovered:Math.max(0,demand-balance),missedCutoff:packs>0&&!slot});
   balance-=demand;
  }
  // Reconstruct actual arrival order; early deliveries can overlap several events.
  const ledger=[...events.map(e=>({date:localDate(e.starts_at),type:'use',event:e,quantity:eventDemand(e,p,requests)})),...deliveries.map(d=>({...d,type:'arrival'}))].sort((a,b)=>a.date.localeCompare(b.date)||(a.type==='arrival'?-1:1));
  let projected=stock.quantity;
  for(const entry of ledger){
   if(entry.type==='arrival'){projected+=entry.quantity;entry.balance=projected;entry.excess=p.capacity==null?0:Math.max(0,projected-p.capacity);}
   else projected-=entry.quantity;
  }
  const arrivals=ledger.filter(e=>e.type==='arrival');
  return {product:p,stock:stock.quantity,needs,deliveries:arrivals,unknown:false,pubHold:needs.reduce((s,n)=>s+n.pub,0),eventHold:needs.reduce((s,n)=>s+n.reserved,0),reserve,temporaryExcess:Math.max(0,...arrivals.map(d=>d.excess)),kegCapacityWarning:p.id==='tap'&&arrivals.some(d=>d.balance>350),remaining:balance};
 });
}
// Suggestions require exact till-product mapping and explicit normal-pub dates.
// Daily CSV totals cannot identify a brand/flavour or split a midnight session.
export function trendRate(product,data){
 const label=product.salesProduct;if(!label)return null;if((data.products||[]).filter(p=>!p.archived&&p.salesProduct===label).length>1)return null;
 const dates=[...new Set(data.events.filter(e=>e.kind==='pub'&&!e.cancelled&&Number(e.multiplier)===1&&new Date(e.starts_at)<new Date()).map(e=>localDate(e.starts_at)))].filter(date=>data.imports.some(m=>m.range_start<=date&&m.range_end>=date));
 if(!dates.length)return null;
 const rows=data.sales.filter(r=>dates.includes(r.date)&&r.category==='QP'&&r.product===label),units=rows.reduce((s,r)=>s+Number(r.quantity),0);
 if(!rows.length)return null;
 return {rate:Math.max(0,units/dates.length),dates:dates.length,label,units};
}
