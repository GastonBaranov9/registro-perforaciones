import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crearPDFConDiagnostico } from "../src/pdf/pdf-generate.ts";
import type { ReportePozo } from "../src/services/generar-informe-consultas.ts";

const salida=process.env.RSP06I_EVIDENCE_DIR??path.join(os.tmpdir(),"rsp06i-pdf-evidencia");await fs.mkdir(salida,{recursive:true});
function reporte(cantidad:{lit:number;diam:number;filtros:number;aportes:number}):ReportePozo{
  const profundidad=Math.max(100,cantidad.lit+1,cantidad.diam+1,cantidad.filtros+1,cantidad.aportes+1);
  return{id_pozo:90610,propietario:"Propietario humano de evidencia",empresa:"Empresa de evidencia",perforador:"Perforador asociado",sitio:"Paraje de evidencia, Salto",departamento:"Salto",localidad:"Paraje de evidencia",latitud:"-31.388123",longitud:"-57.960456",fecha_inicio:"2026-08-01",fecha_fin:"2026-08-05",profundidad_final_m:profundidad,nivel_estatico_m:8,nivel_dinamico_m:13,caudal_estimado_lh:1800,sello_sanitario:true,pre_filtro:"Grava seleccionada",revestimiento:"PVC: 6",metodo_sedimentario:"Rotación",metodo_rocoso:"Percusión",cementacion:"Registrada",desarrollo:"Registrado",introduccion:null,nombre_archivo:null,foto_url:null,
    litologia:Array.from({length:cantidad.lit},(_,i)=>({desde_m:i,hasta_m:i+1,material:`Material geológico ${i+1}`})),
    diametros:Array.from({length:cantidad.diam},(_,i)=>({desde_m:i,hasta_m:i+1,diametro_pulg:6+(i%3),material_tuberia:i%2?"PVC":"Acero"})),
    filtros:Array.from({length:cantidad.filtros},(_,i)=>({desde_m:i,hasta_m:i+.75,diametro_pulg:6,material_tuberia:i%2?"Acero":"PVC"})),
    niveles_aporte:Array.from({length:cantidad.aportes},(_,i)=>({profundidad_m:i+1}))};
}
const casos={pequeno:{lit:1,diam:1,filtros:0,aportes:1},normal:{lit:5,diam:3,filtros:2,aportes:2},cargado:{lit:12,diam:8,filtros:6,aportes:4},extremo:{lit:90,diam:40,filtros:30,aportes:20}};
const resumen:Record<string,unknown>={};
for(const [nombre,cantidad] of Object.entries(casos)){
  const {documento,diagnostico}=await crearPDFConDiagnostico(reporte(cantidad),90610,{mapa:{}});const bytes=await documento.save();
  await fs.writeFile(path.join(salida,`${nombre}.pdf`),bytes);await fs.writeFile(path.join(salida,`${nombre}.json`),JSON.stringify(diagnostico,null,2));
  const paginasTecnicas=diagnostico.paginas.filter(p=>p.tipo.startsWith("tecnica")).length;
  assert.ok(diagnostico.paginas.every(p=>p.bloques.length>0));assert.ok(diagnostico.tablas.every(t=>(t.fuente??9)>=9));
  if(nombre==="normal")assert.equal(paginasTecnicas,1);
  resumen[nombre]={paginas:documento.getPageCount(),paginas_tecnicas:paginasTecnicas,fuente_minima:Math.min(...diagnostico.tablas.map(t=>t.fuente??9))};
}
console.log(JSON.stringify({salida,resumen}));
