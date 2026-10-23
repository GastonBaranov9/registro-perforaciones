// Evidencia sin API ni base de datos. Compila el componente Angular real con
// modelos de crearPerfilLitologico() y genera PDFs con el renderizador real.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { dibujarPerfilLitologico } from '../src/pdf/perfil-litologico.ts';
import { casosConstructivos } from './perfil-constructivo-casos.ts';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const front=path.join(repo,'front');
const destino=path.resolve(process.argv.slice(2).find(arg=>arg!=='--serve') ?? path.join(tmpdir(),'rsp-perfil-constructivo-evidencia'));
await mkdir(destino,{recursive:true});
const casos=casosConstructivos();
await writeFile(path.join(destino,'casos.json'),JSON.stringify(casos,null,2));
for(const [nombre,perfil] of Object.entries(casos)) {
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  dibujarPerfilLitologico(doc,perfil,font,bold);
  await writeFile(path.join(destino,`caso-${nombre}.pdf`),await doc.save());
}
const temporal=await mkdtemp(path.join(front,'.perfil-visual-'));
const browserProfile=await mkdtemp(path.join(tmpdir(),'rsp-perfil-chrome-'));
let server:ReturnType<typeof createServer>|undefined;
try {
  await writeFile(path.join(temporal,'main.ts'),`
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { PerfilLitologicoComponent } from '../src/app/shared/components/perfil-litologico/perfil-litologico.component';
import { PerfilLitologicoService } from '../src/app/shared/services/perfil-litologico.service';
import { PerfilLitologico } from '../src/app/shared/types/schemas';
const casos=${JSON.stringify(casos)};
@Component({selector:'app-visual',imports:[PerfilLitologicoComponent],
 providers:[{provide:PerfilLitologicoService,useValue:{}}],
 template:'<main><h1>Caso {{nombre}} · revisión constructiva</h1><app-perfil-litologico [modelo]="modelo" /></main>',
 styles:['main{max-width:1000px;margin:24px auto;padding:0 20px;color:#18202a;background:white}h1{font:24px Arial}']})
class VisualApp {
 nombre=new URLSearchParams(location.search).get('caso') || 'A';
 modelo=(casos[this.nombre as keyof typeof casos] || casos.A) as unknown as PerfilLitologico;
}
bootstrapApplication(VisualApp,{providers:[provideZonelessChangeDetection()]});
`);
  await writeFile(path.join(temporal,'tsconfig.json'),JSON.stringify({extends:'../tsconfig.app.json',files:['main.ts'],include:['main.ts']}));
  await writeFile(path.join(temporal,'index.html'),'<!doctype html><html lang="es"><head><meta charset="utf-8"><base href="/"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Revisión local del perfil</title></head><body><app-visual></app-visual></body></html>');
  execFileSync(process.execPath,[path.join(front,'node_modules/@angular/cli/bin/ng.js'),'build','--configuration=development',
    '--browser='+path.relative(front,path.join(temporal,'main.ts')),
    '--ts-config='+path.relative(front,path.join(temporal,'tsconfig.json')),
    '--index='+path.relative(front,path.join(temporal,'index.html')),
    '--output-path='+path.join(destino,'web'),'--progress=false'],
    {cwd:front,windowsHide:true,stdio:'inherit',timeout:120000});
  const webRoot=path.join(destino,'web/browser');
  server=createServer(async(req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url!,'http://localhost').pathname);
    const file=path.resolve(webRoot,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(webRoot+path.sep)){res.writeHead(403).end();return;}
    try {
      const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
      res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');
      res.end(await readFile(file));
    }catch{res.writeHead(404).end();}
  });
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('Puerto inválido');
  const chrome=process.env.CHROME_BIN??'C:/Program Files/Google/Chrome/Application/chrome.exe';
  for(const nombre of ['A','B','C','D','F','superficieAbierta']) {
    const {stdout}=await promisify(execFile)(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
      '--user-data-dir='+browserProfile,'--window-size=1100,1700','--virtual-time-budget=3000','--hide-scrollbars',
      '--screenshot='+path.join(destino,`preview-${nombre}.png`),'--dump-dom',`http://127.0.0.1:${address.port}/?caso=${nombre}`],
      {windowsHide:true,timeout:30000,maxBuffer:5*1024*1024});
    if(!stdout.includes('nivel-terreno'))throw Error('Angular no renderizó el perfil '+nombre);
    await writeFile(path.join(destino,`preview-${nombre}.html`),stdout);
  }
  console.log('Evidencias: '+destino);
  if (process.argv.includes('--serve')) {
    console.log(`Revisión local: http://127.0.0.1:${address.port}/?caso=A (también B, C, D y F). Ctrl+C para cerrar.`);
    await new Promise<void>(resolve=>process.once('SIGINT',resolve));
  }
} finally {
  await new Promise<void>(resolve=>server ? server.close(()=>resolve()) : resolve());
  // Sólo directorios creados por esta ejecución, verificados antes de borrar.
  for(const [target,parent,prefix] of [[temporal,front,'.perfil-visual-'],[browserProfile,tmpdir(),'rsp-perfil-chrome-']]) {
    const resolved=await realpath(target),base=await realpath(parent);
    if(!resolved.toLowerCase().startsWith((base+path.sep+prefix).toLowerCase()))throw Error('Ruta temporal inválida');
    await rm(resolved,{recursive:true,force:true});
  }
}
