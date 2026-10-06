export const templates={
 soda:{family:'Soda',group:'Soft drinks',unit:'cans',sizeMl:330,pack:20,kind:'staple',countMode:'pack'},
 redbull:{family:'Red Bull',group:'Soft drinks',unit:'cans',sizeMl:250,pack:24,kind:'staple',countMode:'pack'},
 mariestad:{family:'Mariestad',group:'Beer & cider',unit:'bottles',sizeMl:500,pack:15,kind:'staple',countMode:'pack'},
 briskaCan:{family:'Briska',group:'Beer & cider',unit:'cans',sizeMl:330,pack:24,kind:'seasonal',countMode:'pack'},
 briskaGlass:{family:'Briska',group:'Beer & cider',unit:'bottles',sizeMl:330,pack:24,kind:'seasonal',countMode:'pack'},
 ice:{family:'Smirnoff Ice',group:'Beer & cider',unit:'bottles',sizeMl:275,pack:24,kind:'occasional',countMode:'pack'},
 spirit:{family:'Gin',group:'Spirits',unit:'bottles',sizeMl:700,pack:1,kind:'occasional',countMode:'bottle'},
 other:{family:'',group:'Other',unit:'pieces',sizeMl:1,pack:1,kind:'occasional',countMode:'pack'}
};
export function normalizeProduct(p){return {family:p.id==='beer50'?'Mariestad':p.id==='tap'?'Norrlands':p.id==='smirnoff'?'Smirnoff Ice':p.id.startsWith('redbull')?'Red Bull':p.name,flavour:'',location:'Storage',shelf:0,archived:false,kind:['tap','beer50','cola','colazero','fanta','fantazero','sprite','spritezero','redbull','redbullzero'].includes(p.id)?'staple':'occasional',reorder:true,countMode:p.id==='tap'?'keg':'pack',sizeMl:p.id==='tap'?30000:p.id==='beer50'||p.id==='pet'?500:p.id==='smirnoff'?275:p.id.startsWith('redbull')?250:p.id==='guinness'?440:p.id==='sparkling'?750:330,_version:1,...p};}
export function countQuantity(product,line){
 if(!Number.isInteger(line.full)||line.full<0)throw Error('Use whole packs or full bottles.');
 if(product.countMode==='bottle'){
  if(!Array.isArray(line.opened)||line.opened.some(f=>!Number.isFinite(f)||f<0||f>1))throw Error('Choose a remaining amount between empty and full.');
  return line.full+line.opened.reduce((s,n)=>s+n,0);
 }
 if(!Number.isInteger(line.loose)||line.loose<0)throw Error('Use whole loose units.');
 return line.full*product.pack+line.loose;
}
export function orderedProducts(products,location='',query='',archived=false){return products.filter(p=>Boolean(p.archived)===archived&&(!location||p.location===location)&&(!query||`${p.name} ${p.family} ${p.flavour}`.toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>a.location.localeCompare(b.location)||a.shelf-b.shelf||a.name.localeCompare(b.name));}
export function familyTotals(products,data,stock){
 const families=new Map();
 for(const p of products.filter(p=>!p.archived&&p.countMode!=='keg'&&p.unit!=='pieces')){
  const key=p.family||p.name,item=families.get(key)||{name:key,variants:0,unknown:0,units:0,ml:0};
  const quantity=stock(p,data).quantity;item.variants++;if(quantity===null)item.unknown++;else{item.units+=quantity;item.ml+=quantity*p.sizeMl;}families.set(key,item);
 }
 return [...families.values()].filter(f=>f.variants>1).sort((a,b)=>a.name.localeCompare(b.name));
}
