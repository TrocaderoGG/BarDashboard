// Names explicitly printed on the till export, never inferred from generic buttons.
const named=[[/guinness/i,'Guinness','Brand named; serving/container not recorded'],[/smirnoff\s*ice/i,'Smirnoff Ice','Product named'],[/red\s*bull/i,'Red Bull','Brand named; flavour not recorded'],[/melleruds/i,'Melleruds','33 cl appears in the till label'],[/exotic\s*fanta|fanta\s*exotic/i,'Fanta Exotic','50 cl appears in the till label'],[/wisby/i,'Wisby (as recorded)','Check the exact variant against its receipt']];
export function popularNamedProducts(products,catalog=[]){
 const entries=[];
 const brands=[...new Set(catalog.map(p=>p.brand).filter(Boolean))];
 for(const p of products){
  const legacy=named.find(([pattern])=>pattern.test(p.name));
  const brand=brands.find(b=>p.name.toLocaleLowerCase().includes(b.toLocaleLowerCase()));
  if(legacy||brand){const clean=p.name.replace(/^QP[\s-]*/i,'').replace(/^(?:Öl|Cider)\s+/i,'');const canonical=legacy?.[1]||brand;const label=clean.replace(/\s/g,'').toLowerCase()===canonical.replace(/\s/g,'').toLowerCase()?canonical:clean;
   entries.push({...p,label,identityNote:legacy?.[2]||'Brand named; check the exact variant and stock unit'});
  }
 }
 return entries.sort((a,b)=>b.quantity-a.quantity);
}
