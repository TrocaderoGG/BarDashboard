import * as api from './api.js';
import {productLibrary} from './library.js';
import {PRODUCT_TYPES,validateIdentity,productLabel} from './product-identity.js';
import {templates,countQuantity,orderedProducts} from './inventory-model.js';
import {fmt,stockFor} from './model.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(label,action,attrs='')=>`<button type="button" class="btn" data-inv="${action}" ${attrs}>${label}</button>`;
export async function openInventory({refresh,kegs,mode='count'}){
 let data=await api.loadData();if(data.role!=='admin')return;
 const host=document.createElement('dialog');host.className='inventory-dialog';host.setAttribute('aria-label','Stock editor');document.body.append(host);host.showModal();
 let view='catalogue',filters=[],facet='type',category='',manage=mode==='manage',loc='',query='',archived=false,index=0,session=structuredClone(data.countSessions?.filter(s=>s.status==='draft').sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))[0]||null),undo=[],message='',busy=false,dirty=false,saveState='',timer,chain=Promise.resolve(),edit=null;
 loc=session?.location||'';
 if(session)saveState='Saved count ready to continue';
 const products=()=>orderedProducts(data.products,loc,query,archived);
 const countProducts=()=>Object.keys(session?.lines||{}).map(id=>data.products.find(p=>p.id===id)).filter(p=>p&&!p.archived&&p.id!=='tap');
 const active=()=>countProducts()[Math.min(index,countProducts().length-1)];
 const baseline=p=>data.counts.filter(c=>c.product_id===p.id).map(c=>c.counted_at).sort().at(-1)||null;
 const fresh=p=>({full:0,loose:0,opened:[],confirmed:false,productVersion:p._version,baseline:baseline(p)});
 const line=p=>session?.lines[p.id]||fresh(p);
 function begin(){if(!session){session={id:crypto.randomUUID(),revision:0,lines:{},location:loc};dirty=true;}}
 function status(){const el=host.querySelector('#draft-status');if(el)el.textContent=saveState;}
 async function persist(){
  clearTimeout(timer);if(!dirty)return chain;
  const snapshot=structuredClone(session.lines),location=loc;dirty=false;saveState='Saving draft…';status();
  chain=chain.catch(()=>{}).then(async()=>{
   try{session.revision=await api.write('save_count_session',{id:session.id,revision:session.revision,lines:snapshot,location});saveState=api.preview?'Preview draft · temporary':'Draft saved';status();}
   catch(e){dirty=true;saveState='Not saved — '+e.message;status();throw e;}
  });return chain;
 }
 function changed(p,fn){begin();undo.push(structuredClone(session.lines));const l=structuredClone(line(p));fn(l);l.confirmed=false;session.lines[p.id]=l;dirty=true;saveState='Unsaved changes';draw();clearTimeout(timer);timer=setTimeout(()=>persist().catch(()=>{}),350);}
 function options(values,value){return values.map(v=>`<option ${v===value?'selected':''} value="${esc(v)}">${esc(v)}</option>`).join('');}
 function step(label,key,value){return `<div class="count-step"><span>${label}</span><div>${btn('−','step',`data-key="${key}" data-delta="-1" aria-label="Decrease ${label}"`)}<input type="number" min="0" max="100000" step="1" data-count="${key}" aria-label="${label}" inputmode="numeric" value="${value}">${btn('+','step',`data-key="${key}" data-delta="1" aria-label="Increase ${label}"`)}</div></div>`;}
 function catalogue(){const selected=countProducts();return `<h2>${manage?'Product library':'What are you counting?'}</h2><p class="muted">${manage?'Find a product to edit, or add a new variant.':'Pick just the products in front of you. Everything else stays unchanged.'}</p>${!manage&&selected.length?`<section class="mini-list"><h3>Your count · ${selected.length} products</h3>${selected.map(p=>`<div><span>${esc(productLabel(p))}</span>${btn('Remove','select',`data-id="${esc(p.id)}" aria-label="Remove ${esc(productLabel(p))}"`)}</div>`).join('')}${btn('Continue count','start')}${btn('Review count','review')}</section>`:''}${productLibrary(data.products.filter(p=>Boolean(p.archived)===archived&&(manage||p.id!=='tap')),{query,category,filters,facet,selected:selected.map(p=>p.id),prefix:'inv',manage})}<div class="buttons spaced">${btn('Add product','add')}${btn(manage?'Count products':'Manage library','manage')}${manage?btn(archived?'Show active products':'Show archived','archives'):btn('Kegs & tap gas','kegs')}</div>`;}
 function count(){const p=active();if(!p)return `<p>No products to count here.</p>${btn('Add product','add')}${btn('Kegs & tap gas','kegs')}${btn('Review session','review')}`;const l=line(p),q=countQuantity(p,l),old=stockFor(p,data);return `<p class="eyebrow">${index+1} / ${countProducts().length}</p><h2>${esc(productLabel(p))}</h2><p class="small muted">${esc(p.brand||'Brand not recorded')} · ${esc(p.flavour||'Flavour / variant not recorded')}</p><p>${p.countMode==='bottle'?fmt(p.sizeMl)+' ml per bottle':p.pack+' '+esc(p.unit)+' per pack'} · Previous estimate: ${fmt(old.quantity,2)} ${esc(p.unit)}</p><span class="tag">${l.confirmed?'Confirmed':'Not yet confirmed'}</span>${p.packAssumed?'<p class="notice info">Pack size needs confirmation. Count individual units or edit the product first.</p>':step(p.countMode==='bottle'?'Full bottles':'Full packs','full',l.full)}${p.countMode==='bottle'?`<h3>Opened bottles</h3>${l.opened.map((f,i)=>`<div class="opened-bottle"><p>Bottle ${i+1} · ${fmt(f*p.sizeMl)} ml remaining</p><div class="fraction-row">${[0,.25,.5,.75,1].map((v,n)=>btn(['Empty','¼','½','¾','Full'][n],'fraction',`data-index="${i}" data-value="${v}" aria-pressed="${f===v}"`)).join('')}</div><label>Exact ml remaining<input type="number" min="0" max="${p.sizeMl}" step="1" inputmode="decimal" value="${Math.round(f*p.sizeMl)}" data-open="${i}"></label>${btn('Remove bottle','remove-open',`data-index="${i}"`)}</div>`).join('')}${btn('+ Opened bottle','add-open')}`:step('Loose units','loose',l.loose)}<p class="count-total">${fmt(q,2)} ${esc(p.unit)}${p.countMode==='bottle'?' · '+fmt(q*p.sizeMl)+' ml':''}</p>${p.countMode==='bottle'&&l.opened.length?'<p class="small muted">Opened bottle amounts are recorded as estimates.</p>':''}<div class="buttons">${btn('Undo','undo',undo.length?'':'disabled')}${btn('Edit product','edit',`data-id="${p.id}"`)}${btn('Review session','review')}${btn('Add more products','catalogue')}</div><div class="count-dock">${btn('Previous','previous',index?'':'disabled')}${btn('Skip','next')}${btn('Confirm & next','confirm')}</div>`;}
 function review(){const confirmed=Object.entries(session?.lines||{}).filter(([,l])=>l.confirmed);return `<h2>Review count</h2><p>${confirmed.length} products confirmed. ${countProducts().filter(p=>!session?.lines[p.id]?.confirmed).length} selected products not confirmed. All other stock stays unchanged.</p>${confirmed.map(([id,l])=>{const p=data.products.find(p=>p.id===id);return `<article class="inventory-product"><strong>${esc(p?productLabel(p):id)}</strong><span>${p?fmt(countQuantity(p,l),2):'—'} ${esc(p?.unit)}${l.opened?.length?' · estimated':''}</span>${btn('Recount','recount',`data-id="${id}"`)}</article>`;}).join('')}<div class="buttons">${btn('Keep counting','start')}${btn('Add more products','catalogue')}${btn('Publish count','publish',confirmed.length?'':'disabled')}${btn('Discard draft','discard')}</div>`;}
 function editor(){
  const d=edit.definition;if(d.unverifiedIdentity)return `<h2>Historical placeholder</h2><p>This entry’s old counts do not identify a brand or flavour. Add a separate named variant to start accurate tracking.</p>${btn('Add a named variant','duplicate',`data-id="${esc(d.id)}"`)}${btn('Back','catalogue')}`;const field=(label,name,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(d[name]??'')}" ${extra}></label>`;
  return `<h2>${edit.version?'Edit product':'Add a product'}</h2><form id="inventory-product-form">
   ${data.catalogTagsAvailable===false?'<p class="notice info">Run product_tags.sql in Supabase to enable the new product library.</p>':''}
   <div class="inventory-fields">
    ${field('Brand','brand','text','required maxlength="100" list="product-brands" placeholder="e.g. Briska"')}
    <datalist id="product-brands">${[...new Set(data.products.map(p=>p.brand).filter(Boolean))].sort().map(b=>`<option value="${esc(b)}">`).join('')}</datalist>
    <label>Product type<select name="productType" id="product-type" aria-label="Product type">${options(PRODUCT_TYPES,d.productType)}</select></label>
    ${field('Product name (optional)','name','text','maxlength="120" placeholder="Defaults to brand + flavour"')}
    ${field('Flavour / variant','flavour','text','maxlength="100" placeholder="e.g. Mango, Export, Zero"')}
    <label><input type="checkbox" name="alcoholFree" ${d.alcoholFree?'checked':''}> Alcohol-free</label>
    <label>Container<select name="unit" aria-label="Container" ${edit.version?'disabled':''}>${options(d.id==='tap'?['glasses']:['cans','bottles','pieces'],d.unit)}</select></label>
    ${field('Container size · ml','sizeMl','number',`required min="1" max="50000" ${edit.version?'readonly':''}`)}
    <label>Units / pack<input name="pack" type="number" value="${d.packAssumed?'':esc(d.pack)}" required min="1" max="1000" step="1" ${d.countMode==='keg'||d.countMode==='bottle'?'readonly':''} placeholder="Confirm the actual pack size"></label>
    <details class="disclosure"><summary>Tags & planning</summary><div class="inventory-fields">
     <label>Additional tags<input name="tags" maxlength="500" value="${esc((d.tags||[]).join(', '))}" placeholder="e.g. seasonal, gluten-free"></label>
     <p class="small muted">Brand, type, flavour and alcohol-free status are already searchable tags. Use commas between extra tags.</p>
     <label>Counting method<select name="countMode" ${edit.version?'disabled':''}>${options(d.id==='tap'?['keg']:['pack','bottle'],d.countMode)}</select></label>
     <label>Stock type<select name="kind">${options(['staple','seasonal','occasional'],d.kind)}</select></label>
     ${field('Shelf order','shelf','number','step="any"')}${field('Supplier','supplier','text','maxlength="100"')}
     ${field('Supplier product code (optional)','supplierSku','text','maxlength="100"')}
     ${field('Barcode (optional)','barcode','text','maxlength="50"')}
     ${field('Planning storage limit (optional)','capacity','number','min="0" max="100000" step="any"')}
     <label><input type="checkbox" name="reorder" ${d.reorder?'checked':''}> Suggest replenishment</label>
     ${field('Minimum stock · stock units','minimum','number','required min="0" max="100000" step="any"')}
     <label>Till product for pub trend estimate<select name="salesProduct"><option value="">Not mapped</option>${[...new Set(data.sales.filter(r=>r.category==='QP').map(r=>r.product))].sort().map(n=>`<option value="${esc(n)}" ${d.salesProduct===n?'selected':''}>${esc(n)}</option>`).join('')}</select></label>
     <p class="small muted">A generic sales button cannot identify individual brands or flavours. Only map an exact product and matching stock unit.</p>
     ${field('Expected use per opening · stock units','rate','number','required min="0" max="100000" step="any"')}
    </div></details>
   </div><p class="small muted">Can and glass variants share the same brand tags. Different container sizes or counting methods use separate products, preserving their history.</p>
   <div class="buttons"><button class="btn primary" type="submit" ${data.catalogTagsAvailable===false?'disabled':''}>Save product</button>${btn('Cancel','catalogue')}${edit.version?btn('Add flavour / size','duplicate',`data-id="${esc(d.id)}" ${d.id==='tap'?'disabled':''}`)+btn(d.archived?'Restore product':'Archive product','archive'):''}</div>
  </form>`;
 }
 function draw(){host.innerHTML=`<header class="inventory-head"><div><p class="eyebrow">${api.preview?'LOCAL PREVIEW':'Barmaster workspace'}</p><h1>${view==='editor'?'Product':view==='count'?'Count stock':view==='review'?'Finish count':'Your stock'}</h1></div>${btn('Close','close')}</header>${!data.inventoryAvailable?'<div class="notice info">Run the inventory database upgrade before editing products or counting stock.</div>':`<p id="draft-status" role="status">${esc(saveState)}</p>${message?`<p class="notice error" role="alert">${esc(message)}</p>`:''}<div class="inventory-body">${view==='catalogue'?catalogue():view==='count'?count():view==='review'?review():editor()}</div>`}`;}
 function newProduct(template=templates.other){return {id:crypto.randomUUID(),name:'',brand:'',productType:'Other',tags:[],alcoholFree:false,family:'',flavour:'',supplier:'',location:'Storage',shelf:Math.max(0,...data.products.map(p=>Number(p.shelf)))+10,archived:false,rate:0,minimum:0,capacity:null,requestFactor:1,reorder:false,...template,unit:'cans',sizeMl:330,pack:null};}
 async function reload(){data=await api.loadData();}
 async function productSave(d){const {_version,...definition}=d;await api.write('save_product',{definition,version:edit.version});await reload();if(session?.lines[d.id]){session.lines[d.id].confirmed=false;dirty=true;await persist();}view='catalogue';category='';filters=[];query=d.name;manage=false;}
 async function close(){await persist();await chain;host.close();host.remove();await refresh();}
 host.addEventListener('cancel',e=>{e.preventDefault();close().catch(e=>{message=e.message;draw();});});
 host.addEventListener('click',async e=>{
  const target=e.target.closest('[data-inv]');if(!target)return;e.stopPropagation();if(busy)return;
  const action=target.dataset.inv;message='';
  try{
   if(['step','fraction','remove-open','add-open'].includes(action)){
    const p=active();changed(p,l=>{if(action==='step')l[target.dataset.key]=Math.max(0,l[target.dataset.key]+Number(target.dataset.delta));if(action==='fraction')l.opened[Number(target.dataset.index)]=Number(target.dataset.value);if(action==='remove-open')l.opened.splice(Number(target.dataset.index),1);if(action==='add-open')l.opened.push(.5);});return;
   }
   busy=true;target.disabled=true;
   if(action==='close'){await close();return;}
   if(action==='catalogue'){await persist();view='catalogue';}
   if(action==='archives'){archived=!archived;category='';filters=[];query='';}
   if(action==='manage'){manage=!manage;archived=false;category='';filters=[];query='';}
   if(action==='category')category=target.dataset.category;
   if(action==='tag'){category='';const tag=target.dataset.tag;filters=filters.includes(tag)?filters.filter(v=>v!==tag):[...filters,tag];}
   if(action==='select'){begin();const id=target.dataset.id;if(session.lines[id])delete session.lines[id];else session.lines[id]=fresh(data.products.find(p=>p.id===id));dirty=true;await persist();}
   if(action==='start'){begin();index=Math.min(index,Math.max(0,countProducts().length-1));view=countProducts().length?'count':'catalogue';manage=false;archived=false;query='';}
   if(action==='review'){begin();await persist();await chain;view='review';}
   if(action==='previous')index=Math.max(0,index-1);
   if(action==='next'){await persist();if(index<countProducts().length-1)index++;else view='review';}
   if(action==='confirm'){
    const p=active(),l=structuredClone(line(p));countQuantity(p,l);undo.push(structuredClone(session.lines));
    Object.assign(l,{confirmed:true,location:p.location,counted_at:new Date().toISOString(),baseline:baseline(p),productVersion:p._version});session.lines[p.id]=l;dirty=true;await persist();await chain;
    if(index<countProducts().length-1)index++;else view='review';
   }
   if(action==='undo'&&undo.length){session.lines=undo.pop();dirty=true;await persist();}
   if(action==='recount'){const p=data.products.find(p=>p.id===target.dataset.id);loc=p.location;index=countProducts().findIndex(p=>p.id===target.dataset.id);view='count';await reload();}
   if(action==='add'){edit={definition:newProduct(),version:0};view='editor';}
   if(action==='edit'||action==='duplicate'){
    const p=data.products.find(p=>p.id===target.dataset.id);edit={definition:{...structuredClone(p),...(data.settings[p.id]||{})},version:p._version};
    if(action==='duplicate')edit={definition:{...edit.definition,id:crypto.randomUUID(),name:'',flavour:'',shelf:Math.max(0,...data.products.filter(q=>q.location===p.location).map(q=>Number(q.shelf)))+10,rate:0,minimum:0,archived:false,unverifiedIdentity:false,packAssumed:Boolean(p.packAssumed||p.unverifiedIdentity),reorder:false,kind:'seasonal'},version:0};view='editor';
   }
   if(action==='archive'){edit.definition.archived=!edit.definition.archived;await productSave(edit.definition);}
   if(action==='move'){
    const list=products().filter(p=>p.location===data.products.find(p=>p.id===target.dataset.id).location),i=list.findIndex(p=>p.id===target.dataset.id),j=i+Number(target.dataset.direction);
    if(list[j]){const p=list[i],other=list[j],shelf=Number(target.dataset.direction)<0?(Number(other.shelf)+Number(list[j-1]?.shelf??Number(other.shelf)-20))/2:(Number(other.shelf)+Number(list[j+1]?.shelf??Number(other.shelf)+20))/2;await api.write('save_product',{definition:{...p,shelf},version:p._version});await reload();}
   }
   if(action==='kegs'){await close();kegs();return;}
   if(action==='discard'){await persist();await api.write('finish_count_session',{id:session.id,revision:session.revision,discard:true});session=null;undo=[];view='catalogue';saveState='Draft discarded';}
   if(action==='publish'){await persist();await chain;await api.write('finish_count_session',{id:session.id,revision:session.revision});session=null;undo=[];saveState=api.preview?'Preview count applied':'Count published';await reload();view='catalogue';}
   draw();
  }catch(err){message=err.message;draw();}finally{busy=false;}
 });
 host.addEventListener('input',e=>{if(e.target.id==='inv-search'){const focus=e.target.selectionStart;query=e.target.value;draw();const input=host.querySelector('#inv-search');input.focus();input.setSelectionRange(focus,focus);}});
 host.addEventListener('change',e=>{
  const t=e.target;try{
   if(t.id==='inv-facet'){facet=t.value;draw();}
   if(t.dataset.count){const value=Number(t.value);if(t.value===''||!Number.isInteger(value)||value<0)throw Error('Enter a whole number, zero or greater.');changed(active(),l=>l[t.dataset.count]=value);}
   if(t.dataset.open!==undefined){const value=Number(t.value),p=active();if(t.value===''||value<0||value>p.sizeMl)throw Error('Amount must fit the bottle.');changed(p,l=>l.opened[Number(t.dataset.open)]=value/p.sizeMl);}
   if(t.id==='product-type'&&!edit.version){const values=Object.fromEntries(new FormData(host.querySelector('form')));edit.definition={...edit.definition,...values,tags:[...new Set((values.tags||'').split(',').map(v=>v.trim()).filter(Boolean))],alcoholFree:['Soft drink','Energy drink'].includes(t.value),reorder:Boolean(values.reorder)};if(t.value==='Spirit')Object.assign(edit.definition,{unit:'bottles',sizeMl:700,countMode:'bottle',pack:1});else if(edit.definition.countMode==='bottle')Object.assign(edit.definition,{countMode:'pack',pack:1});draw();}

  }catch(err){message=err.message;draw();}
 });
 host.addEventListener('submit',async e=>{
  e.preventDefault();e.stopPropagation();if(busy)return;busy=true;const submit=e.target.querySelector('[type=submit]');submit.disabled=true;
  try{const values=Object.fromEntries(new FormData(e.target)),d={...edit.definition,...values};for(const key of ['pack','sizeMl','shelf','rate','minimum'])d[key]=Number(d[key]);d.capacity=values.capacity===''?null:Number(values.capacity);d.reorder=Boolean(values.reorder);d.brand=d.brand.trim();d.flavour=d.flavour.trim();d.name=d.name.trim()||(d.flavour?`${d.brand} ${d.flavour}`:'');d.tags=[...new Set((values.tags||'').split(',').map(v=>v.trim()).filter(Boolean))];d.alcoholFree=['Soft drink','Energy drink'].includes(d.productType)||Boolean(values.alcoholFree);d.group=d.productType;d.family=d.brand;d.location='Storage';d.packAssumed=false;validateIdentity(d,data.products);if(d.countMode==='bottle'){d.pack=1;d.unit='bottles';}if(!d.name.trim())throw Error('Enter a product name.');await productSave(d);message='';draw();}
  catch(err){message=err.message;const alert=document.createElement('p');alert.className='notice error';alert.setAttribute('role','alert');alert.textContent=message;e.target.prepend(alert);submit.disabled=false;}finally{busy=false;}
 });
 if(mode==='add'){edit={definition:newProduct(),version:0};view='editor';}
 draw();
}
