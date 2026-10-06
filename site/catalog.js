// Business data is loaded only after the server authorizes membership.
export const CATALOG = [];
export const PRODUCT = {};
export function setCatalog(products) {
  CATALOG.splice(0,CATALOG.length,...products);
  for(const key of Object.keys(PRODUCT)) delete PRODUCT[key];
  Object.assign(PRODUCT,Object.fromEntries(products.map(p=>[p.id,p])));
}
