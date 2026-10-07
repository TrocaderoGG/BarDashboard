import {CATALOG} from './catalog-seed.mjs';
export function previewData(sales) {
  const quantities=[110,18,36,13,22,30,12,28,13,30,23,9,25,12,7,24,6];
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const upcoming=(days)=>{const d=new Date(today+'T16:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString();};
  return {role:'admin',products:CATALOG,settings:{},counts:CATALOG.filter(p=>!p.id.startsWith('briska-')).map((p,i)=>({id:p.id,product_id:p.id,quantity:quantities[i],counted_at:today+'T08:00:00Z'})),movements:[],events:[{id:'preview-pub',name:'Wednesday pub',starts_at:upcoming(1),multiplier:1,cancelled:false},{id:'preview-event',name:'Autumn event',starts_at:upcoming(14),multiplier:2.5,cancelled:false}],requests:[],sales:sales?.rows||[],imports:sales?[sales.meta]:[],kegs:Array.from({length:7},(_,i)=>({id:String(i+1),slot:i+1,state:i===0?'on_tap':i===1?'cold':i===3?'warm':'empty',glasses:i===0?10:[1,3].includes(i)?50:0,chilled_since:i<2?'2026-10-01T08:00:00Z':null}))};
}
