import {config} from './config.js';
import {setCatalog} from './catalog.js';
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
    setCatalog(local.products);return structuredClone(local);
  }
  const role=await rpc('my_role',{});
  if(!role) throw Error('This account is not on the organization’s member list. Ask the barmaster for access.');
  const [products,counts,movements,events,requests,kegs,settings,sales,imports]=await Promise.all(['products','stock_counts','stock_movements','events','order_requests','keg_slots','product_settings','sales_daily','sales_imports'].map(rows));
  let purchases=[],purchasesAvailable=true;
  try {purchases=await rows('purchase_orders');}
  catch(error) {if(['PGRST205','42P01'].includes(error.code))purchasesAvailable=false;else throw error;}
  const approvedDemand=await rpc('approved_demand',{});
  setCatalog(products.map(p=>p.definition));
  return {role,products:products.map(p=>p.definition),counts,movements,events,requests,kegs,sales,imports,purchases,purchasesAvailable,approvedDemand,settings:Object.fromEntries(settings.map(s=>[s.id,s.definition]))};
}
export async function write(action,payload) {
  if(!preview) return rpc(action,{payload});
  // Deliberately ephemeral: this local review mode never claims to share or save data.
  const now=new Date().toISOString();
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
