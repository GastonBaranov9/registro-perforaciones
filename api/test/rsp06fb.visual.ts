import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { crearPerfilLitologico, dibujarPerfilLitologico, type PerfilLitologico } from "../src/pdf/perfil-litologico.ts";

const destino = process.argv[2];
if (!destino) throw new Error("Uso: node rsp06fb.visual.ts <directorio-salida>");
await fs.mkdir(destino, { recursive: true });

const casoA = crearPerfilLitologico([{desde_m:0,hasta_m:100,material:"Arena"}],100,[],[
  {desde_m:0,hasta_m:25,diametro_pulg:8,material_tuberia:"PVC"},
  {desde_m:25,hasta_m:100,diametro_pulg:6,material_tuberia:"Acero"},
])!;
const casoB = crearPerfilLitologico([
  {desde_m:0,hasta_m:49,material:"Arena"},{desde_m:49,hasta_m:61,material:"Grava"},{desde_m:61,hasta_m:100,material:"Roca"},
],100,[{profundidad_m:60}],[{desde_m:0,hasta_m:100,diametro_pulg:6,material_tuberia:"PVC"}],[{desde_m:50,hasta_m:70,diametro_pulg:6,material_tuberia:"PVC"}])!;
const casoD = crearPerfilLitologico(Array.from({length:64},(_,i)=>({desde_m:i*.5,hasta_m:(i+1)*.5,material:`Estrato ${i+1}`})),240,[{profundidad_m:12},{profundidad_m:28}],[
  {desde_m:0,hasta_m:120,diametro_pulg:8,material_tuberia:"PVC"},{desde_m:120,hasta_m:240,diametro_pulg:6,material_tuberia:"Acero"},
],[{desde_m:20,hasta_m:30,diametro_pulg:6,material_tuberia:"PVC"}])!;

for (const [nombre, perfil] of [["caso-a-tuberias",casoA],["caso-b-filtro-aporte",casoB],["caso-d-multipagina",casoD]] as const) {
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  dibujarPerfilLitologico(doc,perfil,font,bold);
  await fs.writeFile(path.join(destino,`${nombre}.pdf`),await doc.save());
  await fs.writeFile(path.join(destino,`${nombre}.html`),html(perfil));
}
await fs.writeFile(path.join(destino,"caso-c-refresco.html"),`<!doctype html><meta charset="utf-8"><style>body{font:16px Arial;max-width:800px;margin:40px auto}.estado{padding:20px;border:2px solid #287ca5;background:#eef9ff}</style><h1>Refresco confirmado por API</h1><p>Antes de editar: Tubería PVC · Ø 8 pulg · 0-25 m</p><div class="estado"><strong>Después de guardar, sin recarga manual:</strong><p>Tubería Acero · Ø 6 pulg · 0-25 m</p><p>La versión de vista invalida la consulta anterior y muestra exclusivamente la respuesta vigente.</p></div>`);
console.log(JSON.stringify({destino,paginas:{a:casoA.rangos.length,b:casoB.rangos.length,d:casoD.rangos.length}}));

function html(perfil:PerfilLitologico){const rango=perfil.rangos[0],y=(m:number)=>60+((m-rango.desde_m)/(rango.hasta_m-rango.desde_m))*700,x=(f:number)=>90+f*180;
  const capas=perfil.tramos.filter(t=>t.desde_m<rango.hasta_m&&t.hasta_m>rango.desde_m).map(t=>`<rect x="90" y="${y(Math.max(t.desde_m,rango.desde_m))}" width="180" height="${y(Math.min(t.hasta_m,rango.hasta_m))-y(Math.max(t.desde_m,rango.desde_m))}" fill="${t.estilo.color}" stroke="#111"/>`).join("");
  const construccion=[...perfil.tuberias,...perfil.filtros].filter(t=>t.desde_m<rango.hasta_m&&t.hasta_m>rango.desde_m).map(t=>`<rect x="${x(t.geometria.x_inicio)}" y="${y(Math.max(t.desde_m,rango.desde_m))}" width="${x(t.geometria.x_fin)-x(t.geometria.x_inicio)}" height="${y(Math.min(t.hasta_m,rango.hasta_m))-y(Math.max(t.desde_m,rango.desde_m))}" fill="${t.material_tuberia==='PVC'?'#429bc1':'#858b91'}" stroke="#111"/>${t.tipo==='filtro'?`<path d="M${x(t.geometria.x_inicio)+2} ${y(t.desde_m)+8}h8m-8 10h8m10-10h8m-8 10h8" stroke="#111" stroke-width="2"/>`:''}`).join("");
  const agua=perfil.aportes.filter(a=>a.profundidad_m>=rango.desde_m&&a.profundidad_m<=rango.hasta_m).map(a=>`<rect x="${x(a.geometria.x_inicio)}" y="${y(a.profundidad_m)-6}" width="${x(a.geometria.x_fin)-x(a.geometria.x_inicio)}" height="12" fill="#29a8ed" stroke="#033f87" stroke-width="2"/>`).join("");
  const etiquetas=perfil.etiquetas.filter(e=>e.rango_desde_m===rango.desde_m),lineas=etiquetas.map(e=>`<line x1="${x(e.x_anclaje_normalizado)}" y1="${y(e.profundidad_anclaje_m)}" x2="${310+e.carril*60-8}" y2="${60+e.posicion_y_normalizada*700}" stroke="#555"/>`).join(""),textos=etiquetas.map(e=>`<text x="${310+e.carril*60}" y="${64+e.posicion_y_normalizada*700}">${esc(e.texto)}</text>`).join("");
  return `<!doctype html><meta charset="utf-8"><style>body{font:14px Arial;margin:20px}svg{width:100%;min-width:760px}text{font-size:11px}</style><h1>${esc(perfil.titulo)}</h1><svg viewBox="0 0 760 820">${capas}${construccion}${agua}${lineas}${textos}</svg>`;}
function esc(texto:string){return texto.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);}
