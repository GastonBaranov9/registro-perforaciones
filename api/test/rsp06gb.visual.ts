import fs from "node:fs/promises";
import path from "node:path";
import { crearPDF } from "../src/pdf/pdf-generate.ts";
import type { ReportePozo } from "../src/services/generar-informe-consultas.ts";

const destino=process.argv[2]??path.resolve("output/rsp06gb"); await fs.mkdir(destino,{recursive:true});
const base:ReportePozo={id_pozo:9608,propietario:"Propietario de control",empresa:"Empresa de perforaciones",perforador:"Equipo técnico",sitio:"Salto",departamento:"Salto",localidad:"Salto",latitud:"-31.388123",longitud:"-57.960456",fecha_inicio:"2026-08-05",fecha_fin:"2026-08-06",profundidad_final_m:100,nivel_estatico_m:8,nivel_dinamico_m:12,caudal_estimado_lh:1800,metodo_sedimentario:"Rotación",metodo_rocoso:"Percusión",cementacion:"Registrada",desarrollo:"Registrado",introduccion:null,nombre_archivo:null,foto_url:null,litologia:[{desde_m:0,hasta_m:20,material:"Arena fina"},{desde_m:20,hasta_m:55,material:"Arcilla limosa de descripción técnica extensa"},{desde_m:55,hasta_m:100,material:"Basalto rosado"}],diametros:[{desde_m:0,hasta_m:20,diametro_pulg:8,material_tuberia:"Acero"},{desde_m:20,hasta_m:100,diametro_pulg:6,material_tuberia:"PVC"}],filtros:[],niveles_aporte:[{profundidad_m:70}]};
const casos=[
  {nombre:"fallback-tablas-sin-filtros",reporte:base},
  {nombre:"tablas-con-filtros",reporte:{...base,filtros:[{desde_m:45,hasta_m:60,diametro_pulg:6,material_tuberia:"PVC"},{desde_m:70,hasta_m:85,diametro_pulg:6,material_tuberia:"Acero"}]}},
  {nombre:"tabla-multipagina",reporte:{...base,litologia:Array.from({length:85},(_,i)=>({desde_m:i,hasta_m:i+1,material:`Estrato técnico ${i+1} con texto extendido para validar wrapping y padding`})),profundidad_final_m:85}}
];
for(const caso of casos) await fs.writeFile(path.join(destino,`${caso.nombre}.pdf`),await(await crearPDF(caso.reporte,9608,{mapa:{}})).save());
await fs.writeFile(path.join(destino,"README.txt"),"Evidencia RSP-06G-B: fallback compacto, tablas sin/con filtros y tabla multipágina. Generada sin proveedor externo ni credenciales.\n");
console.log(JSON.stringify({destino,archivos:casos.map(c=>`${c.nombre}.pdf`)}));
