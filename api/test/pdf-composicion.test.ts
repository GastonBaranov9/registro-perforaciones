import assert from "node:assert/strict";
import test from "node:test";
import { crearPDFConDiagnostico } from "../src/pdf/pdf-generate.ts";
import { leerCoordenadas, obtenerMapaEstatico } from "../src/pdf/mapa-estatico.ts";
import type { ReportePozo } from "../src/services/generar-informe-consultas.ts";

function base(): ReportePozo { return { id_pozo:77,propietario:"Propietario de control",empresa:"Empresa de control",perforador:"Perforador",sitio:"Salto",departamento:"Salto",localidad:"Salto",latitud:"-31.388123",longitud:"-57.960456",fecha_inicio:"2026-08-05",fecha_fin:"2026-08-06",profundidad_final_m:100,nivel_estatico_m:8,nivel_dinamico_m:12,caudal_estimado_lh:1500,metodo_sedimentario:"Rotación",metodo_rocoso:"Percusión",cementacion:"Sí",desarrollo:"Registrado",introduccion:null,nombre_archivo:null,foto_url:null,litologia:[{desde_m:0,hasta_m:50,material:"Arena"},{desde_m:50,hasta_m:100,material:"Basalto rosado"}],diametros:[{desde_m:0,hasta_m:100,diametro_pulg:6,material_tuberia:"Acero"}],filtros:[{desde_m:50,hasta_m:70,diametro_pulg:6,material_tuberia:"PVC"}],niveles_aporte:[{profundidad_m:60}]}; }

test("portada ubicación y páginas técnicas contienen bloques reales sin títulos huérfanos",async()=>{const {documento,diagnostico}=await crearPDFConDiagnostico(base(),77,{mapa:{}});assert.equal(diagnostico.paginas[0].tipo,"portada");assert.equal(diagnostico.paginas[1].tipo,"ubicacion");assert.ok(diagnostico.paginas.every(p=>p.bloques.length>0));assert.ok(diagnostico.paginas.filter(p=>p.tipo==="tecnica").every(p=>!p.bloques.some((b,i)=>b.startsWith("seccion:")&&i===p.bloques.length-1)));assert.ok(documento.getPageCount()>=3);});

test("tablas extensas continúan sin páginas vacías",async()=>{const r=base();r.litologia=Array.from({length:90},(_,i)=>({desde_m:i,hasta_m:i+1,material:`Material técnico extenso ${i}`}));r.profundidad_final_m=90;const {diagnostico}=await crearPDFConDiagnostico(r,77,{mapa:{}});assert.ok(diagnostico.paginas.length>4);assert.ok(diagnostico.paginas.every(p=>p.bloques.length>0));});

test("coordenadas distinguen latitud longitud y rechazan rangos inválidos",()=>{assert.deepEqual(leerCoordenadas("-31.2","-57.9"),{latitud:-31.2,longitud:-57.9});assert.equal(leerCoordenadas("91","0"),null);assert.equal(leerCoordenadas(null,"0"),null);});

test("mapa valida host redirección tipo tamaño y permite imagen configurada",async()=>{const c={latitud:-31,longitud:-57};const config={plantillaUrl:"https://maps.example/static?lat={latitud}&lon={longitud}&key={apiKey}",hostPermitido:"maps.example",clave:"secreto",atribucion:"Datos del proveedor",maxBytes:20};
  const imagen=await obtenerMapaEstatico(c,config,async()=>new Response(new Uint8Array([137,80,78,71]),{status:200,headers:{"content-type":"image/png"}}));assert.equal(imagen.estado,"disponible");
  assert.equal((await obtenerMapaEstatico(c,{...config,hostPermitido:"otro.example"})).estado,"no-disponible");
  assert.equal((await obtenerMapaEstatico(c,config,async()=>new Response(null,{status:302}))).estado,"no-disponible");
  assert.equal((await obtenerMapaEstatico(c,config,async()=>new Response("texto",{headers:{"content-type":"text/plain"}}))).estado,"no-disponible");
  assert.equal((await obtenerMapaEstatico(c,config,async()=>new Response(new Uint8Array(30),{headers:{"content-type":"image/png"}}))).estado,"no-disponible");
});
