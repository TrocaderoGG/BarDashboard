import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {previewData} from './preview-data.mjs';
const root=resolve('site');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/__preview/state') {
      const sales=await readFile('private/sales.json','utf8').then(JSON.parse).catch(()=>null);
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(previewData(sales)));return;
    }
    const file=path==='/__preview/sales'?resolve('private/sales.json'):resolve(root,'.'+(path==='/'?'/index.html':path));
    if(path!=='/__preview/sales'&&!file.startsWith(root+'/')) {res.writeHead(403);res.end();return;}
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/json','Cache-Control':'no-store'});
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(4173,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:4173 (private data stays on this machine)'));
