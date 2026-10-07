export const KEG_LITRES=30;
export const KEG_SERVINGS=50;
export function litresToServings(litres){
 const value=Number(litres);
 if(litres===''||!Number.isFinite(value)||value<0||value>KEG_LITRES)throw Error('Enter remaining litres from 0 to 30.');
 return Math.round(value/KEG_LITRES*KEG_SERVINGS);
}
export function kegSummary(kegs){
 const occupied=kegs.filter(k=>k.state!=='empty');
 return {full:occupied.filter(k=>Number(k.glasses)===KEG_SERVINGS).length,opened:occupied.filter(k=>Number(k.glasses)<KEG_SERVINGS).length,servings:occupied.reduce((s,k)=>s+Number(k.glasses),0)};
}
