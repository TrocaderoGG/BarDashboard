import {normalizeProduct,countQuantity} from './inventory-model.js';
import {config} from './config.js';
import {setCatalog} from './catalog.js';
import {validateIdentity} from './product-identity.js';
export const preview = ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
export const configured=Boolean(config.supabaseUrl&&config.supabaseKey);
let session;
try {session=JSON.parse(sessionStorage.getItem('qp-session')||'null');}catch{session=null;}
function saveSession(value) {
  session=value?.access_token?{...value,expires_at:Date.now()/1000+value.expires_in}:null;
  if(session) sessionStorage.setItem('qp-session',JSON.stringify(session));else sessionStorage.removeItem('qp-session');
}
let refreshPromise;
export const signedIn = ()=>preview||Boolean(session);
async function call(path,{method='GET',body,auth=true,headers={}}={}) {
  if(!configured) throw Error('The shared database is not connected yet.');
  if(auth&&session&&session.expires_at<Date.now()/1000+60) {
    if(!refreshPromise) refreshPromise=call('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token},auth:false}).then(saveSession).finally(()=>refreshPromise=null);
    await refreshPromise;
  }
  const res=await fetch(config.supabaseUrl+path,{method,headers:{apikey:config.supabaseKey,'Content-Type':'application/json',...(auth&&session?{Authorization:'Bearer '+session.access_token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const result=res.status===204?null:await res.json().catch(()=>null);
  if(!res.ok) {if(res.status===401&&auth)saveSession(null);const error=Error(result?.message||result?.msg||result?.error_description||'The shared service could not complete this action. Try again.');error.code=result?.code;throw error;}
  return result;
}
export const sendCode=email=>call('/auth/v1/otp',{method:'POST',body:{email,create_user:false},auth:false});
export async function signInWithPassword(email,password) {
  saveSession(await call('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},auth:false}));
}
export async function verifyCode(email,token) {saveSession(await call('/auth/v1/verify',{method:'POST',body:{email,token,type:'email'},auth:false}));}
export async function signOut(){try{if(configured&&session)await call('/auth/v1/logout',{method:'POST'});}finally{saveSession(null);}}
export const rpc=(name,body)=>call('/rest/v1/rpc/'+name,{method:'POST',body});
async function rows(table) {
  const all=[];let offset=0;
  for(;;) {
    const page=await call(`/rest/v1/${table}?select=*&order=id&limit=1000&offset=${offset}`);
    all.push(...page);if(page.length<1000)return all;offset+=1000;
  }
}
let local;
export async function loadData() {
  if(preview) {
    if(!local) local=await fetch('./__preview/state').then(r=>{if(!r.ok)throw Error('Local preview data is unavailable.');return r.json();});
    local.products=local.products.map((p,i)=>normalizeProduct({...p,_stockVersion:local.counts.filter(c=>c.product_id===p.id).length+local.movements.filter(m=>m.product_id===p.id).length,shelf:p.shelf??i*10}));local.countingAvailable=true;local.tapSuppliesAvailable=true;local.internalSupplies??=[];local.inventoryAvailable=true;local.planningAvailable=true;local.catalogTagsAvailable=true;local.countSessions??=[];local.supplierOrders??=[];local.deliveriesAvailable=true;setCatalog(local.products);return structuredClone(local);
  }
  const role=await rpc('my_role',{});
  if(!role) throw Error('This account is not on the organization’s member list. Ask the barmaster for access.');
  const [products,counts,movements,events,requests,kegs,settings,sales,imports]=await Promise.all(['products','stock_counts','stock_movements','events','order_requests','keg_slots','product_settings','sales_daily','sales_imports'].map(rows));
  let internalSupplies=[],tapSuppliesAvailable=kegs.every(k=>k.version!==undefined);
  if(role==='admin')try{internalSupplies=await rows('internal_supplies');}catch(error){if(['PGRST205','42P01'].includes(error.code))tapSuppliesAvailable=false;else throw error;}
  let purchases=[],purchasesAvailable=true;
  let pubSales=[],pubImports=[];
  try {[pubSales,pubImports]=await Promise.all(['sales_sessions_daily','sales_session_imports'].map(rows));}
  catch(error){if(!['PGRST205','42P01'].includes(error.code))throw error;}
  try {purchases=await rows('purchase_orders');}
  catch(error) {if(['PGRST205','42P01'].includes(error.code))purchasesAvailable=false;else throw error;}
  let countSessions=[],inventoryAvailable=products.every(p=>p.version!==undefined);
  if(inventoryAvailable&&role==='admin'){try{countSessions=await rows('count_sessions');}catch(error){if(['PGRST205','42P01'].includes(error.code))inventoryAvailable=false;else throw error;}}
  let planningAvailable=false;try{planningAvailable=await rpc('planning_ready',{})===true;}catch(error){if(!['PGRST202','42883'].includes(error.code))throw error;}
  let supplierOrders=[],deliveriesAvailable=true;
  if(role==='admin')try{supplierOrders=await rows('supplier_orders');}catch(error){if(['PGRST205','42P01'].includes(error.code))deliveriesAvailable=false;else throw error;}
  let catalogTagsAvailable=false;try{catalogTagsAvailable=await rpc('catalog_tags_ready',{})===true;}catch(error){if(!['PGRST202','42883'].includes(error.code))throw error;}
  const approvedDemand=await rpc('approved_demand',{});
  const catalogue=products.map(p=>normalizeProduct({...p.definition,_version:p.version||1,_stockVersion:p.stock_version}));setCatalog(catalogue);
  return {role,countingAvailable:products.every(p=>p.stock_version!==undefined),internalSupplies,tapSuppliesAvailable,catalogTagsAvailable,supplierOrders,deliveriesAvailable,products:catalogue,countSessions,inventoryAvailable,planningAvailable,counts,movements,events,requests,kegs,sales,imports,pubSales,pubImports,purchases,purchasesAvailable,approvedDemand,settings:Object.fromEntries(settings.map(s=>[s.id,s.definition]))};
}
export async function write(action,payload) {
  if(!preview) return rpc(action,{payload});
  // Deliberately ephemeral: this local review mode never claims to share or save data.
  const now=new Date().toISOString();
  if(action==='save_product_count'){
    const existing=local.countSessions.find(s=>s.id===payload.id);
    if(existing?.status==='published')return true;
    const p=local.products.find(p=>p.id===payload.product_id),l=payload.line;
    if(!p||p.archived||p.unverifiedIdentity||p.id==='tap')throw Error('Choose an available named product');
    const stockVersion=local.counts.filter(c=>c.product_id===p.id).length+local.movements.filter(m=>m.product_id===p.id).length;
    if(stockVersion!==l.stockVersion)throw Error('Stock changed while you were counting. Start a fresh count.');
    if(p._version!==l.productVersion)throw Error('Product changed. Start a fresh count.');
    if(existing&&existing.revision!==payload.revision)throw Error('Draft changed. Reopen it.');
    if(p.packAssumed&&l.full>0)throw Error('Confirm the pack size first');
    const quantity=countQuantity(p,l);if(quantity===0&&!l.zeroConfirmed)throw Error('Use Out of stock to confirm a zero count');
    const counted_at=now;local.counts.push({id:crypto.randomUUID(),batch_id:payload.id,product_id:p.id,quantity,counted_at,details:{...structuredClone(l),pack:p.pack,sizeMl:p.sizeMl,estimated:p.countMode==='bottle'&&l.opened.length>0}});
    if(existing)Object.assign(existing,{status:'published',revision:existing.revision+1});
    else local.countSessions.push({id:payload.id,status:'published',revision:1,lines:{[p.id]:structuredClone(l)}});
    for(const draft of local.countSessions.filter(s=>s.status==='draft'&&s.id!==payload.id&&s.lines[p.id])){delete draft.lines[p.id];draft.revision++;if(!Object.keys(draft.lines).length)draft.status='discarded';}return true;
  }
  if(action==='save_internal_supply'){
    local.internalSupplies??=[];const old=local.internalSupplies.find(s=>s.id===payload.id);
    if((old?.version||0)!==payload.version)throw Error('Supply count changed. Reopen before saving.');
    const value={...structuredClone(payload),version:payload.version+1,counted_at:now};
    if(old)Object.assign(old,value);else local.internalSupplies.push(value);return value.version;
  }
  if(action==='save_kegs_checked'){
    if(payload.kegs.some(k=>k.version!==(local.kegs.find(s=>s.slot===k.slot)?.version||1)))throw Error('Kegs changed. Reopen before saving.');
    payload={...payload,kegs:payload.kegs.map(k=>({...k,version:k.version+1}))};action='save_kegs';
  }
  if(action==='save_product') {
    validateIdentity(payload.definition,local.products);
    const i=local.products.findIndex(p=>p.id===payload.definition.id),version=(local.products[i]?._version||0)+1;
    const product={...payload.definition,_version:version};if(i<0)local.products.push(product);else local.products[i]=product;
    delete local.settings[product.id];return version;
  }
  if(action==='save_count_session'){
    local.countSessions??=[];local.supplierOrders??=[];local.deliveriesAvailable=true;let s=local.countSessions.find(s=>s.id===payload.id);
    if(s){if(s.revision!==payload.revision)throw Error('Draft changed');Object.assign(s,structuredClone(payload),{revision:s.revision+1});}
    else{ s={...structuredClone(payload),revision:1,status:'draft'};local.countSessions.push(s); }return s.revision;
  }
  if(action==='finish_count_session'){
    const s=local.countSessions.find(s=>s.id===payload.id);if(s.status==='published')return true;
    if(!payload.discard)for(const [id,line] of Object.entries(s.lines))if(line.confirmed){const p=local.products.find(p=>p.id===id);local.counts.push({id:crypto.randomUUID(),product_id:id,quantity:countQuantity(p,line),counted_at:line.counted_at,details:{...line,estimated:p.countMode==='bottle'&&line.opened.length>0}});}
    s.status=payload.discard?'discarded':'published';return true;
  }
  if(action==='save_supplier_order'){
    const old=local.supplierOrders.find(o=>o.id===payload.id);
    if(old&&(old.status!=='ordered'||old.version!==payload.version))throw Error('Order changed. Reopen it.');
    const lines=payload.lines.map(l=>{const p=local.products.find(p=>p.id===l.product_id),pack=p.countMode==='bottle'?1:p.pack;return {...l,name:p.name,unit:p.unit,mode:p.countMode,pack,quantity:payload.unplanned?null:l.full*pack+l.loose};});
    const value={...structuredClone(payload),lines,status:'ordered',version:(old?.version||0)+1,created_at:old?.created_at||now};
    if(old)Object.assign(old,value);else local.supplierOrders.push(value);return value.version;
  }
  if(action==='receive_supplier_order'){
    const order=local.supplierOrders.find(o=>o.id===payload.id);if(order.status==='received')return true;
    if(order.version!==payload.version)throw Error('Order changed. Reopen it.');
    const lines=order.lines.map(e=>{const a=payload.lines.find(l=>l.product_id===e.product_id);if(!a?.checked)throw Error('Confirm every product.');const received=a.full*e.pack+a.loose;return {...e,received,difference:e.quantity===null?null:received-e.quantity};});
    if(lines.some(l=>l.difference!==null&&l.difference!==0)&&payload.note.trim().length<3)throw Error('Explain missing or extra items.');
    const tap=lines.find(l=>l.mode==='keg'),empty=local.kegs.filter(k=>k.state==='empty').sort((a,b)=>(a.slot<=3)-(b.slot<=3)||a.slot-b.slot);
    if(tap&&tap.received/50>empty.length)throw Error('Not enough empty keg slots. Update the keg slots first.');
    if(tap)for(const k of empty.slice(0,tap.received/50))Object.assign(k,{state:k.slot<=3?'chilling':'warm',glasses:50,chilled_since:k.slot<=3?now:null});
    for(const l of lines)if(l.received>0)local.movements.push({id:crypto.randomUUID(),product_id:l.product_id,quantity:l.received,reference:'Supplier order '+order.id,occurred_at:now,kind:'delivery'});
    Object.assign(order,{status:'received',version:order.version+1,received_at:now,receipt:{lines,note:payload.note}});return true;
  }
  if(action==='submit_request'){
    if(!local.requests.some(r=>r.id===payload.id))local.requests.unshift({...payload,created_at:now,status:'pending',user_id:'preview',review_note:null});
    return payload.id;
  }
  if(action==='revise_request'){
    Object.assign(local.requests.find(r=>r.id===payload.id),payload,{status:'pending',review_note:null});
    return payload.id;
  }
  if(action==='review_request') Object.assign(local.requests.find(r=>r.id===payload.id),{status:payload.status,review_note:payload.note,event_id:payload.event_id||null});
  if(action==='save_count') {
    for(const line of payload.lines)local.counts.push({...line,id:crypto.randomUUID(),counted_at:payload.counted_at});
    if(payload.kegs)local.kegs=payload.kegs;
  }
  if(action==='record_movement') {
    if(local.movements.some(m=>m.reference===payload.reference))throw Error('This delivery or breakage reference is already recorded.');
    for(const line of payload.lines)local.movements.push({...line,id:crypto.randomUUID(),occurred_at:payload.occurred_at,reference:payload.reference,kind:payload.kind});
  }
  if(action==='save_event') {const i=local.events.findIndex(e=>e.id===payload.id);if(i>=0)local.events[i]=payload;else local.events.push(payload);}
  if(action==='save_settings') for(const line of payload.products)local.settings[line.id]=line;
  if(action==='save_kegs') {
    local.kegs=payload.kegs;
    local.counts.push({id:crypto.randomUUID(),product_id:'tap',quantity:payload.kegs.reduce((s,k)=>s+k.glasses,0),counted_at:now});
  }
  return true;
}
