import {localDate,fmt,dateLabel} from './model.js';
import {escapeHTML as esc} from './library.js';
export function pastMonthRange(now=new Date()){
 const to=localDate(now),start=new Date(to+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-29);
 return {from:start.toISOString().slice(0,10),to,category:'all'};
}
export function median(values){if(!values.length)return null;const v=[...values].sort((a,b)=>a-b),mid=Math.floor(v.length/2);return v.length%2?v[mid]:(v[mid-1]+v[mid])/2;}
export function drinkLabel(label){return /(?:öl|cider|läsk|red\s*bull|drink|shot|snake\s*bite)/iu.test(label)&&!/(?:märke|biljett|mat\s*-)/iu.test(label);}
const describe=values=>({typical:median(values),low:values.length?Math.min(...values):null,busy:values.length?Math.max(...values):null});
const nextDate=date=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
export function pubSource(data){
 const imports=data.imports||[],sessionGrouped=imports.length>0&&imports.every(i=>i.id&&(data.pubImports||[]).some(p=>p.id===i.id&&p.cutoff_hour===4&&p.time_zone==='Europe/Stockholm'));
 return {sales:sessionGrouped?data.pubSales||[]:data.sales||[],imports,sessionGrouped};
}
export function pubBasisNotice(data){return pubSource(data).sessionGrouped?'Pub dates run from 04:00 to 04:00 Stockholm time; after-midnight sales belong to the previous evening.':'Calendar-day totals · overnight grouping has not been imported yet. After-midnight sales are still separate, so these figures are not complete pub-session averages.';}
export function pubComparison(data,range,now=new Date(),options={}){
 const source=pubSource(data);let today=localDate(now);
 if(source.sessionGrouped&&Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Stockholm',hour:'2-digit',hourCycle:'h23'}).format(now))<4){const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);today=d.toISOString().slice(0,10);}
 const within=date=>date>=range.from&&date<=range.to&&date<today;
 const calendarCovered=date=>source.imports.some(i=>i.range_start<=date&&i.range_end>=date);
 const covered=date=>calendarCovered(date)&&(!source.sessionGrouped||calendarCovered(nextDate(date)));
 const blocked=new Set((data.events||[]).filter(e=>e.cancelled||e.kind==='event').map(e=>localDate(e.starts_at)));
 const rows=source.sales.filter(r=>r.category==='QP'&&within(r.date)&&!blocked.has(r.date)&&(!source.sessionGrouped||covered(r.date)));
 const references=[...new Set((data.events||[]).filter(e=>e.kind==='pub'&&!e.cancelled&&Number(e.multiplier)===1).map(e=>localDate(e.starts_at)))].filter(d=>within(d)&&covered(d)&&!blocked.has(d)&&[3,5].includes(new Date(d+'T12:00:00Z').getUTCDay()));
 const basis=options.basis==='marked'?'marked':options.basis==='observed'?'observed':references.length?'marked':'observed';
 const dates=basis==='marked'?references:[...new Set(rows.filter(r=>Number(r.quantity)>0).map(r=>r.date))];
 const labels=[...new Set(rows.filter(r=>dates.includes(r.date)&&drinkLabel(r.product)).map(r=>r.product))];
 const groups=[{weekday:3,name:'Wednesday'},{weekday:5,name:'Friday'}].map(g=>{
  const days=dates.filter(d=>new Date(d+'T12:00:00Z').getUTCDay()===g.weekday).sort();
  const nights=days.map(date=>{const day=rows.filter(r=>r.date===date);return {date,revenue:day.reduce((s,r)=>s+Number(r.gross_ore),0),drinks:Math.max(0,day.filter(r=>drinkLabel(r.product)).reduce((s,r)=>s+Number(r.quantity),0))};});
  return {...g,dates:days,nights,revenue:describe(nights.map(n=>n.revenue/100)),drinks:describe(nights.map(n=>n.drinks)),products:labels.map(label=>({label,...describe(days.map(d=>Math.max(0,rows.filter(r=>r.date===d&&r.product===label).reduce((s,r)=>s+Number(r.quantity),0))))}))};
 });
 const products=labels.map(label=>({label,wednesday:groups[0].products.find(p=>p.label===label),friday:groups[1].products.find(p=>p.label===label)})).sort((a,b)=>Math.max(b.wednesday.typical||0,b.friday.typical||0)-Math.max(a.wednesday.typical||0,a.friday.typical||0));
 return {basis,groups,products,sessionGrouped:source.sessionGrouped};
}
export function customerScenario(group,purchasesPerCustomer){
 const factor=Number(purchasesPerCustomer);if(!Number.isFinite(factor)||factor<=0||factor>20||!group.dates.length)return null;
 return {typical:Math.ceil(group.drinks.typical/factor),busy:Math.ceil(group.drinks.busy/factor)};
}
export function pubInsights(data,range,purchasesPerCustomer=''){
 if(!['all','QP'].includes(range.category))return '<section class="panel pub-insights"><div class="panel-body"><h2>Wednesday & Friday pubs</h2><p>Choose QP or All QP categories to compare regular pub sales.</p></div></section>';
 const comparison=pubComparison(data,range),{groups,products,basis}=comparison;
 return `<section class="panel pub-insights"><div class="panel-head"><div><h2>Wednesday & Friday pubs</h2><p>Selected period: ${dateLabel(range.from)}–${dateLabel(range.to)} · ${basis==='marked'?'marked normal pubs':'QP trading dates'}</p></div></div><div class="panel-body"><div class="pub-day-cards">${groups.map(g=>`<article><h3>${g.name}</h3><p class="small muted">${g.dates.length} ${comparison.sessionGrouped?'pub sessions':basis==='marked'?'normal pub dates':'trading dates'}${g.dates.length<3?' · limited sample':''}</p>${g.dates.length?`<p class="pub-demand">${fmt(g.drinks.typical,1)} <span>drink items</span></p><p>Median per ${comparison.sessionGrouped?'pub':'date'} · busiest observed ${fmt(g.drinks.busy,1)}</p><p class="small muted">Typical sales ${fmt(g.revenue.typical)} SEK, including food and other QP items.</p>`:'<p>No comparable dates in this period.</p>'}</article>`).join('')}</div><p class="small muted">Typical means median; busiest is the largest observed value, not an upper limit for the next pub. ${basis==='marked'?'Uses covered dates marked Normal pub with 1× usage, including zero-sale dates.':'Uses dates with recorded QP sales. These are not confirmed normal pubs; mark historical openings as Normal pub for a cleaner comparison.'} Cancelled and explicitly marked event dates are excluded. Today is excluded because it may be incomplete. ${pubBasisNotice(data)}</p><details class="disclosure"><summary>What to prepare</summary><div class="purchase-scroll"><table class="stock-table pub-demand-table"><thead><tr><th>Sales label</th><th>Wednesday<br>Typical / busiest</th><th>Friday<br>Typical / busiest</th></tr></thead><tbody>${products.slice(0,12).map(p=>`<tr><td>${esc(p.label)}</td><td>${fmt(p.wednesday.typical,1)} / ${fmt(p.wednesday.busy,1)}</td><td>${fmt(p.friday.typical,1)} / ${fmt(p.friday.busy,1)}</td></tr>`).join('')||'<tr><td colspan="3">No comparable drink sales.</td></tr>'}</tbody></table></div><p class="small muted">Net drink-item sales after refunds, with zero for an absent label on an included date. Generic cider, beer and soda labels do not identify brands or flavours. Add mixers, wastage, reserves and event needs separately; these figures do not change inventory or orders.</p></details><details class="disclosure"><summary>Customer workload estimate</summary><p>Customer attendance is not recorded in this export. Merchandise is excluded from drink demand. Transaction lines and items sold are not unique customers.</p><label>Assumed drink purchases per customer<input id="pub-purchases-per-customer" type="number" min="0.1" max="20" step="0.1" inputmode="decimal" value="${esc(purchasesPerCustomer)}" placeholder="Enter your own assumption"></label><div id="pub-customer-scenario">${customerScenarioHTML(groups,purchasesPerCustomer)}</div><p class="small muted">This is a sales-based scenario for staffing, not measured attendance. It excludes people buying nothing or only food, and depends on your assumption. No default customer number is invented.</p></details><details class="disclosure"><summary>Comparison dates & limitations</summary>${groups.map(g=>`<p><strong>${g.name}:</strong> ${g.dates.map(d=>dateLabel(d)).join(', ')||'None'}</p>`).join('')}<p class="small muted">${pubBasisNotice(data)} Drink items use recognized beer, cider, soda, energy drink, cocktail and shot labels; unidentified labels are excluded. Recipes and mixer use are not inferred. The comparison uses QP only; other QP event categories are kept out.</p></details></div></section>`;
}
export function customerScenarioHTML(groups,factor){return groups.map(g=>{const value=customerScenario(g,factor);return `<p><strong>${g.name}:</strong> ${value?`≈${fmt(value.typical)} customers at typical drink sales · ≈${fmt(value.busy)} at busiest observed sales`:'Enter an assumption; comparable sales dates are also required.'}</p>`;}).join('');}
