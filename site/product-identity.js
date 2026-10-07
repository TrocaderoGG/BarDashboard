// Product identities describe real variants. Till buttons remain separate sales records.
export const PRODUCT_TYPES=['Beer','Cider','RTD','Soft drink','Energy drink','Spirit','Wine','Other'];
export const KNOWN_IDENTITIES={
 tap:{brand:'Norrlands Guld',productType:'Beer',name:'Norrlands Guld Export · 30 L keg',flavour:'Export'},
 beer50:{brand:'Mariestad',productType:'Beer',name:'Mariestad Export · 50 cl bottle',flavour:'Export'},
 guinness:{brand:'Guinness',productType:'Beer',flavour:'Stout',packAssumed:true},
 smirnoff:{brand:'Smirnoff',productType:'RTD',name:'Smirnoff Ice · 27.5 cl bottle',flavour:'Ice'},
 cola:{brand:'Coca-Cola',productType:'Soft drink',flavour:'Original',alcoholFree:true},
 colazero:{brand:'Coca-Cola',productType:'Soft drink',flavour:'Zero',alcoholFree:true},
 fanta:{brand:'Fanta',productType:'Soft drink',flavour:'Original',alcoholFree:true},
 fantazero:{brand:'Fanta',productType:'Soft drink',flavour:'Zero',alcoholFree:true},
 sprite:{brand:'Sprite',productType:'Soft drink',flavour:'Original',alcoholFree:true},
 spritezero:{brand:'Sprite',productType:'Soft drink',flavour:'Zero',alcoholFree:true},
 redbull:{brand:'Red Bull',productType:'Energy drink',flavour:'Original',alcoholFree:true},
 redbullzero:{brand:'Red Bull',productType:'Energy drink',flavour:'Sugarfree',alcoholFree:true}
};
export const GENERIC_NAMES=new Set(['Beer · 33 cl','Cider · 33 cl','Alcohol-free beer / cider','Soft drinks · 50 cl PET','Sparkling wine']);
// A short stored name must not hide the structured identity of its variant.
export function productLabel(p){
 const name=(p.name||'').trim(),brand=(p.brand||'').trim(),flavour=(p.flavour||'').trim();
 const words=value=>value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const contains=(text,part)=>!part||(' '+words(text)+' ').includes(' '+words(part)+' ');
 let label=name||brand||'Unnamed product';
 if(brand&&!contains(label,brand))label=brand+' '+label;
 if(flavour&&!contains(label,flavour))label+=' · '+flavour;
 return label;
}
export function identityFor(p){
 const known=KNOWN_IDENTITIES[p.id]||{},generic=GENERIC_NAMES.has(p.name)&&!p.brand;
 return {...known,...p,brand:p.brand||known.brand||'',productType:p.productType||known.productType||({Spirits:'Spirit',Wine:'Wine','Soft drinks':'Soft drink'}[p.group])||'Other',flavour:p.flavour||known.flavour||'',tags:p.tags||[],alcoholFree:p.alcoholFree??known.alcoholFree??false,archived:Boolean(p.archived)||generic,unverifiedIdentity:generic,packAssumed:p.packAssumed??Boolean(!p.brand&&known.packAssumed)};
}
export function productTags(p){return {brand:p.brand||'',type:p.productType||p.group||'Other',flavour:p.flavour||'',tag:[...(p.tags||[]),...(p.alcoholFree?['Alcohol-free']:[])]};}
export function tagValues(p,facet){const value=productTags(p)[facet];return Array.isArray(value)?value:value?[value]:[];}
export function matchesTags(p,filters=[]){return filters.every(token=>{const split=token.indexOf(':');return tagValues(p,token.slice(0,split)).includes(token.slice(split+1));});}
export function productKey(p){return [p.brand,p.productType,p.flavour?.trim()||p.name,p.sizeMl,p.unit,Boolean(p.alcoholFree)].map(v=>String(v??'').trim().toLowerCase()).join('|');}
export function validateIdentity(p,products=[]){
 if(!p.brand?.trim()||!p.name?.trim())throw Error('Enter a brand and a specific product name.');
 if(!PRODUCT_TYPES.includes(p.productType))throw Error('Choose a product type.');
 if(GENERIC_NAMES.has(p.name.trim()))throw Error('Use the actual product name, not a generic till label.');
 if(!Array.isArray(p.tags)||p.tags.length>12||p.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>40))throw Error('Use up to 12 tags, at most 40 characters each.');
 if(products.some(q=>q.id===p.id&&q.unverifiedIdentity))throw Error('Create a new named variant; legacy counts do not identify a product.');
 if(products.some(q=>q.id!==p.id&&!q.archived&&productKey(q)===productKey(p)))throw Error('This product variant already exists. Edit it instead.');
 return p;
}
