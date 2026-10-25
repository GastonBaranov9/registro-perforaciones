// Sólo build local y respuestas ficticias. Perfil Chrome nuevo; nunca sesión productiva.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const out=fs.mkdtempSync(path.join(os.tmpdir(),'rsp025-visual-'));
const base=path.resolve('dist/front/browser');
const server=http.createServer((req,res)=>{
 const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'');
 const candidate=path.resolve(base,relative);
 if(!candidate.startsWith(base+path.sep)&&candidate!==base){res.writeHead(403).end();return;}
 const file=fs.existsSync(candidate)&&fs.statSync(candidate).isFile()?candidate:path.join(base,'index.html');
 res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');
 res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,profile=path.join(out,'profile');
const chrome=spawn(process.env.CHROME_BIN??'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--disable-background-networking','about:blank'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws,serial=0;const pending=new Map();let writes=0;const requests=[];
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++serial,t=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);pending.set(id,{resolve:r=>{clearTimeout(t);resolve(r);},reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const user={id_usuario:1,nombre:'Administración de ensayo',activo:true,email:'admin@example.test',roles:[{id_rol:1,nombre:'administracion',descr:'Administración'}]};
const revision={anterior:32823,nuevo:3282,tipo:'retroceso',disponible:true,motivo:'Corregir error de tipeo',salto_grande:true,bloqueos:[],token:'ficticio'};
try{
 let port;for(let i=0;i<80;i++){try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{await sleep(100);}}
 assert.ok(port,'Chrome disponible');const target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 ws.addEventListener('message',async({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result);}if(m.method==='Fetch.requestPaused'){
  const {requestId,request}=m.params,u=new URL(request.url),p=u.pathname.replace(/^\/api/,'');
  requests.push({method:request.method,path:u.pathname});
  const api=u.pathname.startsWith('/api/')||u.origin!==origin;
  if(!api){await send('Fetch.continueRequest',{requestId});return;}
  if(['PUT','DELETE','PATCH'].includes(request.method))writes++;
  let body=null;if(p==='/login')body=user;else if(p==='/pozos/numeracion')body={proximo:32823,minimo:3282,agotado:false,puede_retroceder:true};else if(p==='/pozos/numeracion/revision')body=revision;else if(p==='/pozos/numeracion/historial')body=[];
  await send('Fetch.fulfillRequest',{requestId,responseCode:body===null?404:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Credentials',value:'true'},{name:'Access-Control-Allow-Headers',value:'content-type,authorization,x-csrf-token'}],body:Buffer.from(JSON.stringify(body??{})).toString('base64')});
 }});
 await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.WebSocket=class {addEventListener(){} removeEventListener(){} close(){} send(){} static OPEN=1;};'});
 const results=[];
 for(const width of [390,768,1366]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:origin+'/pozos-numeracion'});
  for(let i=0;i<80;i++){if(await evaluate("!!document.querySelector('input[name=proximo]')"))break;await sleep(150);}
  assert.ok(await evaluate("!!document.querySelector('input[name=proximo]')"),'Pantalla autenticada renderizada');
  for(let i=0;i<50;i++){if(await evaluate("document.querySelector('.resumen strong')?.textContent.trim()==='32823'"))break;await sleep(100);}
  await evaluate(`(()=>{const a=document.querySelector('input[name=proximo]'),b=document.querySelector('textarea[name=motivo]');a.value='3282';a.dispatchEvent(new Event('input',{bubbles:true}));b.value='Corregir error de tipeo';b.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(200);await evaluate("document.querySelector('.panel form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  for(let i=0;i<50;i++){if(await evaluate("!!document.querySelector('.comparacion')"))break;await sleep(100);}
  if(!await evaluate("!!document.querySelector('.comparacion')")){
   fs.writeFileSync(path.join(out,'failure.txt'),await evaluate('document.body.innerText'));
   fs.writeFileSync(path.join(out,'requests.json'),JSON.stringify(requests));
   throw Error('Vista previa no visible; evidencia ficticia: '+out);
  }
  const geometry=await evaluate(`(()=>{const s=document.querySelector('.numeracion-shell');return {width:innerWidth,content:s.scrollWidth,sections:document.querySelectorAll('nav[aria-label="Herramientas de numeración"] button').length,warning:document.body.textContent.includes('error de tipeo')};})()`);
  assert.ok(geometry.content<=width);assert.equal(geometry.sections,5);assert.ok(geometry.warning);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(out,'numeracion-'+width+'.png'),Buffer.from(shot.data,'base64'));results.push(geometry);
 }
 assert.equal(writes,0);fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({results,realApiConnections:0,writes,productionTouched:false}));console.log(JSON.stringify({passed:results.length,out}));
}finally{ws?.close();chrome.kill();server.close();}
