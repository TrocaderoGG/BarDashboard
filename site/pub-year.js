import {pubComparison,pubBasisNotice} from './pub-insights.js?v=0f6322fc3219';
import {fmt,dateLabel} from './model.js';
import {escapeHTML as esc} from './library.js';
const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
export function pubYears(data){
 const years=new Set((data.sales||[]).filter(r=>r.category==='QP').map(r=>Number(r.date.slice(0,4))));
 for(const i of data.imports||[])for(let year=Number(i.range_start.slice(0,4));year<=Number(i.range_end.slice(0,4))&&year<2100;year++)years.add(year);
 return [...years].filter(y=>Number.isInteger(y)&&y>=2020&&y<2100).sort((a,b)=>b-a);
}
export function yearlyPubAverages(data,year,metric='revenue',now=new Date(),basis='observed'){
 if(!Number.isInteger(Number(year))||year<2020||year>=2100)throw Error('Choose a valid year.');
 if(!['revenue','drinks'].includes(metric)||!['observed','marked'].includes(basis))throw Error('Choose a valid comparison.');
 const comparison=pubComparison(data,{from:`${year}-01-01`,to:`${year}-12-31`,category:'all'},now,{basis});
 const value=night=>metric==='revenue'?night.revenue/100:night.drinks;
 const months=Array.from({length:12},(_,i)=>{const month=`${year}-${String(i+1).padStart(2,'0')}`;return {month,groups:comparison.groups.map(g=>{const nights=g.nights.filter(n=>n.date.startsWith(month)),values=nights.map(value);return {name:g.name,count:nights.length,dates:nights.map(n=>n.date),samples:nights.map(n=>({date:n.date,value:value(n)})),average:mean(values),low:values.length>1?Math.min(...values):null,high:values.length>1?Math.max(...values):null};})};});
 return {year:Number(year),metric,basis,sessionGrouped:comparison.sessionGrouped,months,groups:comparison.groups.map(g=>({name:g.name,count:g.nights.length,average:mean(g.nights.map(value))}))};
}
// Shared conservative tangents keep the curves within adjacent values.
function smoothControls(points){
 const slopes=points.slice(1).map((p,i)=>(p.y-points[i].y)/(p.x-points[i].x));
 const tangents=points.map((_,i)=>i===0?slopes[0]:i===points.length-1?slopes.at(-1):slopes[i-1]*slopes[i]<=0?0:Math.sign(slopes[i])*Math.min(Math.abs(slopes[i-1]),Math.abs(slopes[i])));
 return points.slice(1).map((p,i)=>{const prev=points[i],dx=(p.x-prev.x)/3;return [{x:prev.x+dx,y:prev.y+tangents[i]*dx},{x:p.x-dx,y:p.y-tangents[i+1]*dx},p];});
}
export function smoothPath(points){
 if(!points.length)return '';
 return `M ${points[0].x} ${points[0].y}`+smoothControls(points).map(c=>` C ${c.map(p=>`${p.x} ${p.y}`).join(', ')}`).join('');
}
export function rangeRibbon(points){
 if(!points.length)return '';
 // A single observed month gets a small tapered lens, never an invented neighbouring month.
 if(points.length===1){const p=points[0];return `M ${p.x-9} ${p.average} C ${p.x-4} ${p.high}, ${p.x+4} ${p.high}, ${p.x+9} ${p.average} C ${p.x+4} ${p.low}, ${p.x-4} ${p.low}, ${p.x-9} ${p.average} Z`;}
 const centres=smoothControls(points.map(p=>({x:p.x,y:p.average})));
 const above=smoothControls(points.map(p=>({x:p.x,y:p.average-p.high})));
 const below=smoothControls(points.map(p=>({x:p.x,y:p.low-p.average})));
 const upper=centres.map((c,i)=>c.map((p,j)=>({x:p.x,y:p.y-above[i][j].y})));
 const lower=centres.map((c,i)=>c.map((p,j)=>({x:p.x,y:p.y+below[i][j].y})));
 const first=points[0],last=points.at(-1);
 return `M ${first.x} ${first.high}`+upper.map(c=>` C ${c.map(p=>`${p.x} ${p.y}`).join(', ')}`).join('')+` L ${last.x} ${last.low}`+lower.map((c,i)=>[c[1],c[0],i?lower[i-1][2]:{x:first.x,y:first.low}]).reverse().map(c=>` C ${c.map(p=>`${p.x} ${p.y}`).join(', ')}`).join('')+' Z';
}
export function showPubYearPoint(target){
 const point=target.closest?.('[data-year-point]');if(!point)return;
 const section=point.closest('.pub-year');if(!section)return;
 section.querySelectorAll('[data-year-detail]').forEach(detail=>detail.hidden=detail.dataset.yearDetail!==point.dataset.yearPoint);
 section.querySelectorAll('[data-year-point]').forEach(p=>p.setAttribute('aria-pressed',String(p===point)));
 const prompt=section.querySelector('.pub-year-point-prompt');if(prompt)prompt.hidden=true;
}
export function pubYearGraph(result){
 const {months,metric,year}=result,values=months.flatMap(m=>m.groups.flatMap(g=>[g.average,g.low,g.high])).filter(v=>v!==null),unit=metric==='revenue'?'SEK':'drink items';
 if(!values.length)return '<p class="empty">No comparable Wednesday or Friday dates in this year. Mark historical normal pubs if using that filter.</p>';
 const left=64,right=720,top=20,bottom=216,min=Math.min(0,...values),max=Math.max(1,...values),span=(max-min)*1.12;
 const x=i=>left+i*(right-left)/11,y=v=>bottom-(v-min)/span*(bottom-top),colours=['#236c61','#b8612b'];
 const grid=Array.from({length:4},(_,i)=>{const v=min+span*i/3;return `<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" stroke="#e8ede9" stroke-width="0.7"/><text x="${left-12}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="#758179">${fmt(v)}</text>`;}).join('');
 const lines=result.groups.map((g,index)=>{
  const segments=[];let current=[];
  months.forEach((m,i)=>{const a=m.groups[index].average;if(a===null){if(current.length)segments.push(current);current=[];}else current.push({x:x(i),y:y(a)});});if(current.length)segments.push(current);
  const rangeSegments=[];let band=[];
  months.forEach((m,i)=>{const p=m.groups[index];if(p.low===null){if(band.length)rangeSegments.push(band);band=[];}else band.push({x:x(i),average:y(p.average),low:y(p.low),high:y(p.high)});});if(band.length)rangeSegments.push(band);
  const ranges=rangeSegments.map(points=>`<path class="pub-year-ribbon" d="${rangeRibbon(points)}" fill="${colours[index]}" fill-opacity="0.13" stroke="none" pointer-events="none"/>`).join('');
  return {ranges,marks:segments.map(points=>`<path class="pub-year-line" d="${smoothPath(points)}" fill="none" stroke="${colours[index]}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`).join('')+months.map((m,i)=>{const p=m.groups[index];if(p.average===null)return '';const label=`${dateLabel(m.month+'-01',{day:undefined,month:'long'})} ${g.name}: average ${fmt(p.average,2)} ${unit} from ${p.count} dates. ${p.count===1?'1 date · limited data.':`Observed range ${fmt(p.low,2)}–${fmt(p.high,2)} ${unit}.`} Show individual sales totals.`;
   return `<circle class="pub-year-dot" cx="${x(i)}" cy="${y(p.average)}" r="3" fill="${colours[index]}" stroke="white" stroke-width="1.2" pointer-events="none"/><circle class="pub-year-hit" cx="${x(i)+(index?7:-7)}" cy="${y(p.average)}" r="18" fill="transparent" tabindex="0" role="button" aria-pressed="false" aria-controls="pub-year-point-detail" aria-label="${esc(label)}" data-year-point="${i}-${index}"><title>${esc(label)}</title></circle>`;
  }).join('')};
 });
 const layers=lines.map(l=>l.ranges).join('')+lines.map(l=>l.marks).join('');
 const labels=months.map((m,i)=>`<text x="${x(i)}" y="242" text-anchor="middle" font-size="11" fill="#65736a">${dateLabel(m.month+'-01',{day:undefined,month:'short'})}</text><text x="${x(i)}" y="262" text-anchor="middle" font-size="9" fill="#758179">W ${m.groups[0].count}${m.groups[0].count===1?'*':''} · F ${m.groups[1].count}${m.groups[1].count===1?'*':''}</text>`).join('');
 const details=months.flatMap((m,i)=>m.groups.map((g,j)=>g.count?`<div data-year-detail="${i}-${j}" hidden><strong>${dateLabel(m.month+'-01',{day:undefined,month:'long'})} · ${g.name}</strong><p><b>${fmt(g.average,2)} ${unit}</b> average · ${g.count} ${g.count===1?'date · limited data':'dates'}</p><p class="small muted">${g.count===1?'Only one observation; no range can be calculated.':`Observed range: ${fmt(g.low,2)}–${fmt(g.high,2)} ${unit}. This is not a confidence interval or a forecast.`}</p><ul>${g.samples.map(n=>`<li>${dateLabel(n.date)} <strong>${fmt(n.value,2)} ${unit}</strong></li>`).join('')}</ul></div>`:'')).join('');
 return `<div class="pub-year-chart"><svg viewBox="0 0 760 280" role="group" aria-label="Monthly average ${metric==='revenue'?'QP sales revenue in SEK':'drink items sold'} per Wednesday and Friday date, ${year}. Select a point for its sales totals.">${grid}${layers}${labels}</svg></div><div id="pub-year-point-detail" class="pub-year-point-detail" aria-live="polite" aria-atomic="true"><p class="pub-year-point-prompt small muted">Tap a point to see its average, sample size and individual sales totals.</p>${details}</div>`;
}
export function pubYearSection(data,year,metric='revenue',basis='observed'){
 const result=yearlyPubAverages(data,year,metric,new Date(),basis),years=pubYears(data);if(!years.includes(Number(year)))years.unshift(Number(year));
 return `<section class="panel pub-year"><div class="panel-head"><div><h2>Wednesday & Friday · year view</h2><p>Monthly arithmetic averages per eligible date</p></div></div><div class="panel-body"><div class="pub-year-controls"><label>Comparison year<select id="pub-year">${years.map(y=>`<option value="${y}" ${Number(year)===y?'selected':''}>${y}</option>`).join('')}</select></label><label>Graph measure<select id="pub-year-metric"><option value="revenue" ${metric==='revenue'?'selected':''}>Sales revenue · SEK</option><option value="drinks" ${metric==='drinks'?'selected':''}>Drink items sold</option></select></label><label>Compared dates<select id="pub-year-basis"><option value="observed" ${basis==='observed'?'selected':''}>QP trading dates</option><option value="marked" ${basis==='marked'?'selected':''}>Marked normal pubs only</option></select></label></div><p class="small muted">Full-year view, independent of the date and category filters above. Uses QP only. ${basis==='observed'?'Includes dates with QP sales, excluding explicitly marked events and cancellations.':'Uses covered historical Normal pub dates with 1× usage, including genuine zero-sale dates.'} Current and future dates are excluded.</p><p class="small muted">${pubBasisNotice(data)}</p><div class="pub-year-averages">${result.groups.map((g,i)=>`<div><strong class="weekday-key ${i?'friday':'wednesday'}">${g.name}</strong><p>${fmt(g.average,1)} ${metric==='revenue'?'SEK':'drink items'} <small>year average</small></p><span>${g.count} dates compared</span></div>`).join('')}</div>${pubYearGraph(result)}<p class="small muted">W / F below each month shows the number of Wednesday / Friday dates. Swipe the graph on a phone. Translucent ribbons show the observed lowest–highest sales with decorative smoothing, not error margins or forecast limits. * = 1 date · limited data; no range is drawn. Missing months remain gaps. Curves and ribbon edges are visual guides between recorded months; they do not estimate sales between months.</p><details class="disclosure"><summary>Monthly averages & sample dates</summary><div class="purchase-scroll"><table class="stock-table pub-year-table"><thead><tr><th>Month</th><th>Wednesday average</th><th>Dates</th><th>Friday average</th><th>Dates</th></tr></thead><tbody>${result.months.map(m=>`<tr><td>${dateLabel(m.month+'-01',{day:undefined,month:'short'})}</td><td>${fmt(m.groups[0].average,2)}</td><td>${m.groups[0].count}</td><td>${fmt(m.groups[1].average,2)}</td><td>${m.groups[1].count}</td></tr>`).join('')}</tbody></table></div>${result.months.filter(m=>m.groups.some(g=>g.count)).map(m=>`<p class="small muted"><strong>${dateLabel(m.month+'-01',{day:undefined,month:'long'})}:</strong> ${m.groups.map(g=>g.name+' '+(g.dates.map(d=>dateLabel(d)).join(', ')||'none')).join(' · ')}</p>`).join('')}</details><details class="disclosure"><summary>How the averages are calculated</summary><p>Total ${metric==='revenue'?'QP revenue after refunds':'recognized net drink items'} on eligible ${basis==='observed'?'trading':'normal-pub'} dates in each month, divided by the number of those dates. This uses an arithmetic mean; the past-month “typical” cards use a median. The year averages use all eligible dates rather than averaging monthly averages.</p><p class="small muted">Revenue includes food and merchandise. Drink items exclude merchandise and food and do not represent customers. ${pubBasisNotice(data)} Imported data ends where the export ends; no missing sales are filled in.</p></details></div></section>`;
}
