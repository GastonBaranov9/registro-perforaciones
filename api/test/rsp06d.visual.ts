import fs from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { crearPDF } from "../src/pdf/pdf-generate.ts";
import type { ReportePozo } from "../src/services/generar-informe-consultas.ts";

const destino = process.argv[2];
if (!destino) throw new Error("Uso: node rsp06d.visual.ts <directorio-salida>");
await fs.mkdir(destino, { recursive: true });
await fs.writeFile(path.join(destino, "continuidad-intervalos.html"), `<!doctype html><meta charset="utf-8"><style>body{font:16px Arial;max-width:760px;margin:40px auto}.fila{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:12px;border:1px solid #aaa}input{font:inherit;padding:8px}.nuevo{background:#eef7ff}</style><h1>Continuidad sugerida</h1><div class="fila"><label>Desde<input value="0"></label><label>Hasta<input value="10"></label><label>Material<input value="Arena"></label></div><div class="fila nuevo"><label>Desde sugerido<input value="10"></label><label>Hasta<input placeholder="Completar"></label><label>Material<input placeholder="Completar"></label></div>`);

const publicDir = path.resolve("public"); const id = 90602; const foto = path.join(publicDir, `pozo-${id}.png`);
const base: ReportePozo = { id_pozo:id, propietario:"Propietario de ejemplo", empresa:"Perforación de control RSP-06D", perforador:"Equipo técnico", sitio:"Montevideo - ubicación controlada", fecha_inicio:"2026-01-01", fecha_fin:"2026-02-01", profundidad_final_m:240, nivel_estatico_m:8, nivel_dinamico_m:13, caudal_estimado_lh:1800, metodo_sedimentario:"Rotación", metodo_rocoso:"Percusión", cementacion:"Registrada", desarrollo:"Registrado", introduccion:null, nombre_archivo:null, foto_url:null, litologia:Array.from({length:40},(_,i)=>({desde_m:i,hasta_m:i+1,material:`Estrato ${i+1}`})), diametros:[{desde_m:0,hasta_m:240,diametro_pulg:6}], niveles_aporte:[{profundidad_m:12},{profundidad_m:31}] };
try {
  await fs.writeFile(path.join(destino,"portada-sin-foto.pdf"), await (await crearPDF(base,id)).save());
  for (const [nombre, ancho, alto] of [["vertical",60,140],["horizontal",180,70]] as const) {
    await fs.writeFile(foto, png(ancho,alto));
    await fs.writeFile(path.join(destino,`portada-foto-${nombre}.pdf`), await (await crearPDF({...base,foto_url:"/foto"},id)).save());
  }
} finally { await fs.rm(foto,{force:true}); }
console.log(JSON.stringify({destino,formulario:true,portadas:["sin-foto","vertical","horizontal"],perfilMultipagina:true}));

function png(width:number,height:number){const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const o=y*(width*4+1)+1+x*4;raw[o]=28;raw[o+1]=105+(y%90);raw[o+2]=160;raw[o+3]=255;}const h=Buffer.alloc(13);h.writeUInt32BE(width,0);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",h),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]);}
function chunk(t:string,d:Buffer){const n=Buffer.from(t),o=Buffer.alloc(d.length+12);o.writeUInt32BE(d.length,0);n.copy(o,4);d.copy(o,8);o.writeUInt32BE(crc(Buffer.concat([n,d])),d.length+8);return o;}
function crc(d:Buffer){let c=0xffffffff;for(const b of d){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(0xedb88320&-(c&1));}return(c^0xffffffff)>>>0;}
