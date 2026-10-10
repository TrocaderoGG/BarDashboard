import * as api from './api.js?v=6f6155099a19';
import {openCounting} from './counting.js?v=795ac4ff7060';
import {productLibrary,escapeHTML as esc} from './library.js';
import {PRODUCT_TYPES,validateIdentity} from './product-identity.js';
import {templates} from './inventory-model.js';
const btn=(label,action,attrs='')=>`<button type="button" class="btn" data-inv="${action}" ${attrs}>${label}</button>`;
export async function openInventory({refresh,kegs,mode='count',onClose,initialProductId}){
 if(mode==='count')return openCounting({refresh,kegs,initialProductId,manage:nextMode=>openInventory({refresh,kegs,mode:nextMode,onClose:id=>openInventory({refresh,kegs,initialProductId:id})})});
 let data=await api.loadData();if(data.role!=='admin')return;
 const host=document.createElement('dialog');host.className='inventory-dialog';host.setAttribute('aria-label','Stock editor');document.body.append(host);host.showModal();
 let view='catalogue',query='',filters=[],facet='type',archived=false,edit=null,busy=false,message='';
 const options=(values,value)=>values.map(v=>`<option ${v===value?'selected':''} value="${esc(v)}">${esc(v)}</option>`).join('');
 function catalogue(){return `<h2>Product library</h2>${productLibrary(data.products.filter(p=>Boolean(p.archived)===archived),{query,filters,facet,prefix:'inv',manage:true})}<div class="buttons spaced">${btn('Add product','add')}${btn(archived?'Show active products':'Show archived','archives')}${btn('Count products','count')}</div>`;}
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
 function newProduct(template=templates.other){return {id:crypto.randomUUID(),name:'',brand:'',productType:'Other',tags:[],alcoholFree:false,family:'',flavour:'',supplier:'',location:'Storage',shelf:Math.max(0,...data.products.map(p=>Number(p.shelf)))+10,archived:false,rate:0,minimum:0,capacity:null,requestFactor:1,reorder:false,...template,unit:'cans',sizeMl:330,pack:null};}
 function draw(){host.innerHTML=`<header class="inventory-head"><div><p class="eyebrow">Barmaster workspace</p><h1>${view==='editor'?'Product':'Product library'}</h1></div>${btn('Close','close')}</header>${message?`<p class="notice error" role="alert">${esc(message)}</p>`:''}<div class="inventory-body">${view==='editor'?editor():catalogue()}</div>`;}
 async function reload(){data=await api.loadData();}
 async function close(id){host.close();host.remove();await refresh();if(onClose)await onClose(id);}
 async function productSave(d){const {_version,_stockVersion,...definition}=d;await api.write('save_product',{definition,version:edit.version});await reload();if(mode==='add'){await close(d.id);return true;}view='catalogue';query=d.name;filters=[];return false;}
 host.addEventListener('cancel',e=>{e.preventDefault();close();});
 host.addEventListener('click',async e=>{const target=e.target.closest('[data-inv]');if(!target||busy)return;e.stopPropagation();const action=target.dataset.inv;try{busy=true;message='';
  if(action==='close'){await close();return;}
  if(action==='count'){host.close();host.remove();await refresh();await openInventory({refresh,kegs});return;}
  if(action==='catalogue')view='catalogue';
  if(action==='archives'){archived=!archived;query='';filters=[];}
  if(action==='tag'){const tag=target.dataset.tag;filters=filters.includes(tag)?filters.filter(v=>v!==tag):[...filters,tag];}
  if(action==='add'){edit={definition:newProduct(),version:0};view='editor';}
  if(action==='edit'||action==='duplicate'){const p=data.products.find(p=>p.id===target.dataset.id);edit={definition:{...structuredClone(p),...(data.settings[p.id]||{})},version:p._version};if(action==='duplicate')edit={definition:{...edit.definition,id:crypto.randomUUID(),name:'',flavour:'',rate:0,minimum:0,archived:false,unverifiedIdentity:false,packAssumed:Boolean(p.packAssumed||p.unverifiedIdentity),reorder:false,kind:'seasonal'},version:0};view='editor';}
  if(action==='archive'){edit.definition.archived=!edit.definition.archived;if(await productSave(edit.definition))return;}
  draw();
 }catch(error){message=error.message;draw();}finally{busy=false;}});
 host.addEventListener('input',e=>{if(e.target.id==='inv-search'){const cursor=e.target.selectionStart;query=e.target.value;draw();const input=host.querySelector('#inv-search');input.focus();input.setSelectionRange(cursor,cursor);}});
 host.addEventListener('change',e=>{const t=e.target;if(t.id==='inv-facet'){facet=t.value;draw();}if(t.id==='product-type'&&!edit.version){const values=Object.fromEntries(new FormData(host.querySelector('form')));edit.definition={...edit.definition,...values,tags:[...new Set((values.tags||'').split(',').map(v=>v.trim()).filter(Boolean))],alcoholFree:['Soft drink','Energy drink'].includes(t.value),reorder:Boolean(values.reorder)};if(t.value==='Spirit')Object.assign(edit.definition,{unit:'bottles',sizeMl:700,countMode:'bottle',pack:1});else if(edit.definition.countMode==='bottle')Object.assign(edit.definition,{countMode:'pack',pack:1});draw();}});
 host.addEventListener('submit',async e=>{
  e.preventDefault();e.stopPropagation();if(busy)return;busy=true;const submit=e.target.querySelector('[type=submit]');submit.disabled=true;
  try{const values=Object.fromEntries(new FormData(e.target)),d={...edit.definition,...values};for(const key of ['pack','sizeMl','shelf','rate','minimum'])d[key]=Number(d[key]);d.capacity=values.capacity===''?null:Number(values.capacity);d.reorder=Boolean(values.reorder);d.brand=d.brand.trim();d.flavour=d.flavour.trim();d.name=d.name.trim()||(d.flavour?`${d.brand} ${d.flavour}`:'');d.tags=[...new Set((values.tags||'').split(',').map(v=>v.trim()).filter(Boolean))];d.alcoholFree=['Soft drink','Energy drink'].includes(d.productType)||Boolean(values.alcoholFree);d.group=d.productType;d.family=d.brand;d.location='Storage';d.packAssumed=false;validateIdentity(d,data.products);if(d.countMode==='bottle'){d.pack=1;d.unit='bottles';}if(!d.name.trim())throw Error('Enter a product name.');const closed=await productSave(d);message='';if(!closed)draw();}
  catch(err){message=err.message;const alert=document.createElement('p');alert.className='notice error';alert.setAttribute('role','alert');alert.textContent=message;e.target.prepend(alert);submit.disabled=false;}finally{busy=false;}
 });
 if(mode==='add'){edit={definition:newProduct(),version:0};view='editor';}
 draw();
}
