import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { config } from '../site/config.js';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await cp('site','dist',{recursive:true});
const envUrl=process.env.SUPABASE_URL||'';
const envKey=process.env.SUPABASE_PUBLISHABLE_KEY||'';
if(Boolean(envUrl)!==Boolean(envKey)) throw Error('Set both Supabase environment values together, or neither.');
const url=envUrl||config.supabaseUrl;
const key=envKey||config.supabaseKey;
if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw Error('Expected the HTTPS Supabase project URL.');
if (key.startsWith('sb_secret_')) throw Error('A secret key must never be included in a static website.');
if (key.startsWith('eyJ')) { const payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());if(payload.role!=='anon')throw Error('Only an anon or publishable key is allowed.'); }
await writeFile('dist/config.js',`export const config = ${JSON.stringify({supabaseUrl:url,supabaseKey:key})};\n`);
await writeFile('dist/.nojekyll','');
console.log('Built public shell in dist/. No sales or inventory data is included.');
