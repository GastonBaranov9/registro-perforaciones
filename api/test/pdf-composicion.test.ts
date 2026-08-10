import assert from "node:assert/strict";
import test from "node:test";
import { crearPDFConDiagnostico } from "../src/pdf/pdf-generate.ts";
import { leerCoordenadas, obtenerMapaEstatico } from "../src/pdf/mapa-estatico.ts";
import type { ReportePozo } from "../src/services/generar-informe-consultas.ts";

function base(): ReportePozo { return { id_pozo:77,propietario:"Propietario de control",empresa:"Empresa de control",perforador:"Perforador",sitio:"Salto",departamento:"Salto",localidad:"Salto",latitud:"-31.388123",longitud:"-57.960456",fecha_inicio:"2026-08-05",fecha_fin:"2026-08-06",profundidad_final_m:100,nivel_estatico_m:8,nivel_dinamico_m:12,caudal_estimado_lh:1500,metodo_sedimentario:"Rotación",metodo_rocoso:"Percusión",cementacion:"Sí",desarrollo:"Registrado",introduccion:null,nombre_archivo:null,foto_url:null,litologia:[{desde_m:0,hasta_m:50,material:"Arena"},{desde_m:50,hasta_m:100,material:"Basalto rosado"}],diametros:[{desde_m:0,hasta_m:100,diametro_pulg:6,material_tuberia:"Acero"}],filtros:[{desde_m:50,hasta_m:70,diametro_pulg:6,material_tuberia:"PVC"}],niveles_aporte:[{profundidad_m:60}]}; }

test("caso pequeño mantiene portada, ubicación y técnica como tres páginas principales",async()=>{const {documento,diagnostico}=await crearPDFConDiagnostico(base(),77,{mapa:{}});assert.equal(diagnostico.paginas[0].tipo,"portada");assert.equal(diagnostico.paginas[1].tipo,"ubicacion");assert.equal(diagnostico.paginas[2].tipo,"tecnica");assert.equal(diagnostico.paginas.filter(p=>p.tipo.startsWith("tecnica")).length,1);assert.ok(diagnostico.paginas.every(p=>p.bloques.length>0));assert.ok(diagnostico.tablas.every(t=>t.paginas.length===1&&t.paginas[0]===2));assert.ok(documento.getPageCount()>=3);});

test("caso normal concentra todas las secciones técnicas en la página 3",async()=>{const r=base();r.litologia=Array.from({length:5},(_,i)=>({desde_m:i*10,hasta_m:(i+1)*10,material:`Material ${i}`}));r.diametros=Array.from({length:3},(_,i)=>({desde_m:i*15,hasta_m:(i+1)*15,diametro_pulg:8-i,material_tuberia:"PVC" as const}));r.filtros=Array.from({length:2},(_,i)=>({desde_m:50+i*10,hasta_m:55+i*10,diametro_pulg:6,material_tuberia:"PVC" as const}));r.niveles_aporte=[{profundidad_m:30},{profundidad_m:65}];const {diagnostico}=await crearPDFConDiagnostico(r,77,{mapa:{}});assert.equal(diagnostico.paginas.filter(p=>p.tipo.startsWith("tecnica")).length,1);assert.equal(diagnostico.tablas.length,4);assert.ok(diagnostico.tablas.every(t=>t.fuente!==undefined&&t.fuente>=9));});

test("caso cargado compacta antes de continuar y nunca usa fuente microscópica",async()=>{const r=base();r.litologia=Array.from({length:12},(_,i)=>({desde_m:i,hasta_m:i+1,material:`Material técnico ${i}`}));r.diametros=Array.from({length:8},(_,i)=>({desde_m:i,hasta_m:i+1,diametro_pulg:6,material_tuberia:"Acero" as const}));r.filtros=Array.from({length:6},(_,i)=>({desde_m:i,hasta_m:i+.5,diametro_pulg:6,material_tuberia:"PVC" as const}));const {diagnostico}=await crearPDFConDiagnostico(r,77,{mapa:{}});assert.ok(diagnostico.tablas.every(t=>(t.fuente??9)>=9));assert.ok(diagnostico.paginas.every(p=>p.bloques.length>0));});

test("tablas extensas continúan sin páginas vacías",async()=>{const r=base();r.litologia=Array.from({length:90},(_,i)=>({desde_m:i,hasta_m:i+1,material:`Material técnico extenso ${i}`}));r.profundidad_final_m=90;const {diagnostico}=await crearPDFConDiagnostico(r,77,{mapa:{}});assert.ok(diagnostico.paginas.length>4);assert.ok(diagnostico.paginas.every(p=>p.bloques.length>0));});

test("filas se miden con padding y no se cortan",async()=>{const r=base();r.litologia[0].material="Material de descripción deliberadamente larga que debe envolverse en más de una línea sin tocar sus bordes";const {diagnostico}=await crearPDFConDiagnostico(r,77,{mapa:{}});assert.equal(diagnostico.tablas.length,4);for(const tabla of diagnostico.tablas){assert.ok((tabla.fuente??9)>=9);assert.ok(tabla.alturasFilas.every(alto=>alto>(tabla.fuente??9)));assert.ok(tabla.alturaCompleta>=tabla.alturaEncabezado+tabla.alturasFilas.reduce((a,b)=>a+b,0));assert.ok(tabla.paginas.length>=1);}});

test("filtros vacíos conservan su sección compacta y el fallback de mapa no reserva media página",async()=>{const r=base();r.filtros=[];const {diagnostico}=await crearPDFConDiagnostico(r,77,{mapa:{}});assert.equal(diagnostico.fallbackMapaAlto,72);assert.ok(diagnostico.fallbackMapaAlto<100);assert.equal(diagnostico.tablas.find(t=>t.titulo==="Intervalos de filtro")?.alturasFilas.length,0);});

test("coordenadas distinguen latitud longitud y rechazan rangos inválidos",()=>{assert.deepEqual(leerCoordenadas("-31.2","-57.9"),{latitud:-31.2,longitud:-57.9});assert.equal(leerCoordenadas("91","0"),null);assert.equal(leerCoordenadas(null,"0"),null);});

test("mapa valida host redirección tipo tamaño y permite imagen configurada",async()=>{const c={latitud:-31,longitud:-57};const config={plantillaUrl:"https://maps.example/static?lat={latitud}&lon={longitud}&key={apiKey}",hostPermitido:"maps.example",clave:"secreto",atribucion:"Datos del proveedor",maxBytes:20};
  const imagen=await obtenerMapaEstatico(c,config,async()=>new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{status:200,headers:{"content-type":"image/png"}}));assert.equal(imagen.estado,"disponible");
  assert.equal((await obtenerMapaEstatico(c,{...config,hostPermitido:"otro.example"})).estado,"no-disponible");
  assert.equal((await obtenerMapaEstatico(c,config,async()=>new Response(null,{status:302}))).estado,"no-disponible");
  assert.equal((await obtenerMapaEstatico(c,config,async()=>new Response("texto",{headers:{"content-type":"text/plain"}}))).estado,"no-disponible");
  assert.equal((await obtenerMapaEstatico(c,config,async()=>new Response(new Uint8Array(30),{headers:{"content-type":"image/png"}}))).estado,"no-disponible");
});
test("mapa admite marcadores compartidos lat lon key",async()=>{
  const config={plantillaUrl:"https://maps.example/static?lat={lat}&lon={lon}&key={key}",hostPermitido:"maps.example",clave:"secreto",atribucion:"Proveedor"};
  let solicitada="";
  const resultado=await obtenerMapaEstatico({latitud:-31,longitud:-57},config,async(input)=>{solicitada=String(input);return new Response(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),{headers:{"content-type":"image/png"}});});
  assert.equal(resultado.estado,"disponible");assert.match(solicitada,/lat=-31\.000000&lon=-57\.000000&key=secreto/);
});

test("mapa distingue configuración ausente, plantilla, clave, timeout y firma",async()=>{const c={latitud:-31,longitud:-57};
  assert.deepEqual(await obtenerMapaEstatico(c,{}),{estado:"no-disponible",motivo:"Proveedor de mapa no configurado"});
  const baseConfig={plantillaUrl:"https://maps.example/static",hostPermitido:"maps.example",atribucion:"Proveedor"};
  assert.equal((await obtenerMapaEstatico(c,baseConfig)).estado,"no-disponible");
  assert.deepEqual(await obtenerMapaEstatico(c,{...baseConfig,plantillaUrl:"https://maps.example/{latitud}/{longitud}?key={apiKey}"}),{estado:"no-disponible",motivo:"Clave de mapa ausente"});
  const config={...baseConfig,plantillaUrl:"https://maps.example/{latitud}/{longitud}",timeoutMs:1};
  const timeout=await obtenerMapaEstatico(c,config,(_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(new DOMException("Abortado","AbortError")))));
  assert.deepEqual(timeout,{estado:"no-disponible",motivo:"Tiempo de espera agotado"});
  assert.deepEqual(await obtenerMapaEstatico(c,config,async()=>new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"image/png"}})),{estado:"no-disponible",motivo:"Firma de imagen no válida"});
});

test("mapa limita incrementalmente streams sin Content-Length",async()=>{
  const c={latitud:-31,longitud:-57};const config={plantillaUrl:"https://maps.example/{latitud}/{longitud}",hostPermitido:"maps.example",atribucion:"Proveedor",maxBytes:12};
  const firma=Uint8Array.from([137,80,78,71,13,10,26,10]);
  const menor=new ReadableStream<Uint8Array>({start(controlador){controlador.enqueue(firma);controlador.enqueue(Uint8Array.from([1,2]));controlador.close();}});
  assert.equal((await obtenerMapaEstatico(c,config,async()=>new Response(menor,{headers:{"content-type":"image/png"}}))).estado,"disponible");
  const exacto=new ReadableStream<Uint8Array>({start(controlador){controlador.enqueue(firma);controlador.enqueue(new Uint8Array(4));controlador.close();}});
  assert.equal((await obtenerMapaEstatico(c,config,async()=>new Response(exacto,{headers:{"content-type":"image/png"}}))).estado,"disponible");
  let cancelado=false,abortado=false;
  const excesivo=new ReadableStream<Uint8Array>({start(controlador){controlador.enqueue(firma);controlador.enqueue(new Uint8Array(5));},cancel(){cancelado=true;}});
  const resultado=await obtenerMapaEstatico(c,config,async(_url,init)=>{init?.signal?.addEventListener("abort",()=>{abortado=true;});return new Response(excesivo,{headers:{"content-type":"image/png"}});});
  assert.deepEqual(resultado,{estado:"no-disponible",motivo:"Imagen excesiva"});assert.equal(cancelado,true);assert.equal(abortado,true);
});

test("un stream de mapa excesivo conserva el PDF con fallback compacto",async()=>{
  const stream=new ReadableStream<Uint8Array>({start(controlador){controlador.enqueue(Uint8Array.from([137,80,78,71,13,10,26,10]));controlador.enqueue(new Uint8Array(10));}});
  const {diagnostico}=await crearPDFConDiagnostico(base(),77,{mapa:{plantillaUrl:"https://maps.example/{latitud}/{longitud}",hostPermitido:"maps.example",atribucion:"Proveedor",maxBytes:12},fetchMapa:async()=>new Response(stream,{headers:{"content-type":"image/png"}})});
  assert.equal(diagnostico.fallbackMapaAlto,72);
});
