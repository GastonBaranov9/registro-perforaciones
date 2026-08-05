import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { crearPerfilLitologico, dibujarPerfilLitologico, type PerfilLitologico } from "../src/pdf/perfil-litologico.ts";

const destino=process.argv[2];
if(!destino) throw new Error("Uso: node rsp06fd.visual.ts <directorio-salida>");
await fs.mkdir(destino,{recursive:true});
const perfil=crearPerfilLitologico([
  {desde_m:0,hasta_m:10,material:"Arena fina"},{desde_m:10,hasta_m:59,material:"Arcilla compacta"},
  {desde_m:59,hasta_m:61,material:"Grava acuífera"},{desde_m:61,hasta_m:100,material:"Basalto rosado"},
],100,[{profundidad_m:60}],[
  {desde_m:0,hasta_m:10,diametro_pulg:6,material_tuberia:"Acero"},
  {desde_m:10,hasta_m:100,diametro_pulg:6,material_tuberia:"Acero"},
],[{desde_m:50,hasta_m:70,diametro_pulg:6,material_tuberia:"PVC"}])!;

const grafico=svg(perfil);
for(const vista of ["edicion","detalle"]){
  await fs.writeFile(path.join(destino,`${vista}.html`),`<!doctype html><meta charset="utf-8"><style>body{font:14px Arial;margin:20px;background:#f4f6f8}.panel{max-width:${vista==="edicion"?"720":"980"}px;margin:auto;background:#fff;padding:18px;border:1px solid #aaa}svg{display:block;width:100%;height:auto}text{font:11px Arial}.conector{fill:none;stroke:#555;stroke-width:.8}</style><section class="panel"><h1>${vista==="edicion"?"Vista previa del perfil del pozo":"Perfil litológico del pozo"}</h1>${grafico}</section>`);
}
const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
dibujarPerfilLitologico(doc,perfil,font,bold);
await fs.writeFile(path.join(destino,"perfil.pdf"),await doc.save());
const multipagina=crearPerfilLitologico(Array.from({length:36},(_,i)=>({desde_m:i*.5,hasta_m:(i+1)*.5,material:`Estrato ${i+1}`})),180,[{profundidad_m:12}],
  [{desde_m:0,hasta_m:100,diametro_pulg:8,material_tuberia:"PVC"},{desde_m:100,hasta_m:180,diametro_pulg:6,material_tuberia:"Acero"}], [{desde_m:10,hasta_m:15,diametro_pulg:6,material_tuberia:"PVC"}])!;
const docMulti=await PDFDocument.create(),fontMulti=await docMulti.embedFont(StandardFonts.Helvetica),boldMulti=await docMulti.embedFont(StandardFonts.HelveticaBold);
dibujarPerfilLitologico(docMulti,multipagina,fontMulti,boldMulti);
await fs.writeFile(path.join(destino,"perfil-multipagina.pdf"),await docMulti.save());
console.log(JSON.stringify({destino,hashModelo:createHash("sha256").update(JSON.stringify(perfil)).digest("hex"),paginas:perfil.rangos.length,paginasMultipagina:multipagina.rangos.length}));

function svg(modelo:PerfilLitologico){
  const g=modelo.geometria,r=modelo.rangos[0],y=(m:number)=>g.columna.y+(m-r.desde_m)/(r.hasta_m-r.desde_m)*g.columna.alto,x=(f:number)=>g.columna.x+f*g.columna.ancho;
  const capas=modelo.tramos.map(t=>`<rect x="${g.columna.x}" y="${y(t.desde_m)}" width="${g.columna.ancho}" height="${y(t.hasta_m)-y(t.desde_m)}" fill="${t.estilo.color}" stroke="#222"/>`).join("");
  const tuberias=modelo.tuberias.map(t=>`<rect x="${x(t.geometria.x_inicio)}" y="${y(t.desde_m)}" width="${x(t.geometria.x_fin)-x(t.geometria.x_inicio)}" height="${y(t.hasta_m)-y(t.desde_m)}" fill="#858b91" stroke="#111"/>`).join("");
  const filtros=modelo.filtros.map(t=>`<defs><pattern id="ranuras" width="18" height="12" patternUnits="userSpaceOnUse"><path d="M1 3H7M11 9H17" stroke="#111" stroke-width="2.5"/></pattern></defs><rect x="${x(t.geometria.x_inicio)}" y="${y(t.desde_m)}" width="${x(t.geometria.x_fin)-x(t.geometria.x_inicio)}" height="${y(t.hasta_m)-y(t.desde_m)}" fill="#429bc1" stroke="#111"/><rect x="${x(t.geometria.x_inicio)}" y="${y(t.desde_m)}" width="${x(t.geometria.x_fin)-x(t.geometria.x_inicio)}" height="${y(t.hasta_m)-y(t.desde_m)}" fill="url(#ranuras)"/>`).join("");
  const aportes=modelo.aportes.map(a=>`<rect x="${x(a.geometria.x_inicio)}" y="${y(a.profundidad_m)-6}" width="${x(a.geometria.x_fin)-x(a.geometria.x_inicio)}" height="12" fill="#29a8ed" stroke="#033f87" stroke-width="2"/>`).join("");
  const conectores=modelo.etiquetas.map(e=>`<polyline class="conector" points="${e.conector.puntos.map(p=>`${p.x_normalizada*g.ancho_logico},${p.y_normalizada*g.alto_logico}`).join(" ")}"/>`).join("");
  const textos=modelo.etiquetas.map(e=>`<text x="${e.x_texto_normalizado*g.ancho_logico}" y="${g.columna.y+e.posicion_y_normalizada*g.columna.alto+4}" ${e.tipo==="aporte"?'fill="#052f6d" font-weight="bold"':""}>${esc(e.texto)}</text>`).join("");
  return `<svg viewBox="0 0 ${g.ancho_logico} ${g.alto_logico}" role="img"><rect x="${g.columna.x}" y="${g.columna.y}" width="${g.columna.ancho}" height="${g.columna.alto}" fill="#fafafa" stroke="#111"/>${capas}${tuberias}${filtros}${aportes}${conectores}${textos}</svg>`;
}
function esc(valor:string){return valor.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);}
