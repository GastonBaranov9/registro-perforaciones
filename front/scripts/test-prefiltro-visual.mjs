// Sólo build local y respuestas ficticias. Perfil Chrome nuevo; nunca sesión productiva.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const fixture=path.resolve(process.argv[2]??'');
assert.ok(path.basename(fixture).startsWith('rsp-prefiltro027-'),'Usar sólo evidencia sintética del test PostgreSQL');
const casos=Object.fromEntries(['A','B','C','D','E'].map(c=>[c,JSON.parse(fs.readFileSync(path.join(fixture,c+'.json'),'utf8'))]));
let actual=casos.A;
const out=fs.mkdtempSync(path.join(os.tmpdir(),'rsp027-visual-'));
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
  let body=null;
  if(p==='/login') body=user;
  else if(p.endsWith('/perfil-litologico')||p.endsWith('/perfil-litologico/vista-previa'))body=actual.perfil;
  else if(/\/pozos\/\d+$/.test(p))body=actual.detail;
  else if(p.endsWith('/intervalo_litologico'))body=actual.result.intervalos_litologicos;
  else if(p.endsWith('/intervalo_diametro_perforacion'))body=actual.result.intervalos_diametro;
  else if(p.endsWith('/intervalos_filtro'))body=actual.result.intervalos_filtro;
  else if(p.endsWith('/niveles_aporte'))body=actual.result.niveles_aporte;
  else if(p.includes('candidatos'))body={propietarios:[{id_usuario:2,nombre:'Propietario sintético',roles:['propietario']}],perforadores:[{id_usuario:3,nombre:'Perforador sintético',roles:['perforador']}]};
  else if(p.includes('litologias'))body=[{id_litologia:1,nombre:'Basalto marrón',codigo:'basalto_marron',color:'#73513f',patron:'basalt_brown',activo:true}];
  await send('Fetch.fulfillRequest',{requestId,responseCode:body===null?404:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Credentials',value:'true'},{name:'Access-Control-Allow-Headers',value:'content-type,authorization,x-csrf-token'}],body:Buffer.from(JSON.stringify(body??{})).toString('base64')});
 }});
 await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.WebSocket=class {addEventListener(){} removeEventListener(){} close(){} send(){} static OPEN=1;};'});
 const results=[];
 for(const width of [390,768,1366]) for(const name of ['A','B','C','D','E']) {
  actual=casos[name];
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  for(const mode of ['guardado','preview']) {
    await send('Page.navigate',{url:origin+'/'+(mode==='guardado'?'pozos-detail/':'pozo-edit/')+actual.detail.id_pozo});
    let found=false;for(let i=0;i<80;i++){found=await evaluate("!!document.querySelector('app-perfil-litologico .grafico svg')");if(found)break;await sleep(150);}
    if(!found){fs.writeFileSync(path.join(out,'failure.txt'),await evaluate('document.body.innerText'));fs.writeFileSync(path.join(out,'requests.json'),JSON.stringify(requests));throw Error('Perfil no visible '+mode+' '+out);}
    const pf=await evaluate("Array.from(document.querySelectorAll('app-perfil-litologico text.etiqueta-prefiltro')).map(e=>e.textContent.trim())");
    assert.deepEqual(pf,actual.perfil.etiquetas.filter(e=>e.tipo==='prefiltro').map(e=>e.texto));
    const overflow=await evaluate("document.documentElement.scrollWidth > innerWidth");assert.equal(overflow,false);
    if(name==='E')assert.ok(await evaluate("document.querySelector('app-perfil-litologico').textContent.includes('coinciden en profundidad')"));
    await evaluate("document.querySelector('app-perfil-litologico').scrollIntoView({block:'start'})");await sleep(150);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(out,name+'-'+mode+'-'+width+'.png'),Buffer.from(shot.data,'base64'));
    if(mode==='preview'){
      assert.equal(await evaluate("document.querySelectorAll('[aria-label=Prefiltro] input').length"),actual.body.prefiltro_constructivo.length*2);
      await evaluate("document.querySelector('[aria-label=Prefiltro]').scrollIntoView({block:'start'})");await sleep(100);
      const form=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(out,name+'-form-'+width+'.png'),Buffer.from(form.data,'base64'));
    }
    results.push({name,mode,width,labels:pf.length,overflow});
  }
 }
 assert.equal(writes,0);fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({results,realApiConnections:0,writes,productionTouched:false}));console.log(JSON.stringify({passed:results.length,out}));
}finally{ws?.close();chrome.kill();server.close();}
