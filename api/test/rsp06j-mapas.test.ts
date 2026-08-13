import assert from "node:assert/strict";
import test from "node:test";
import { crearPDFConDiagnostico } from "../src/pdf/pdf-generate.ts";
import { obtenerMapaEstatico, type ConfiguracionMapa } from "../src/pdf/mapa-estatico.ts";
import type { ReportePozo } from "../src/services/generar-informe-consultas.ts";

const plantilla = "https://maps.googleapis.com/maps/api/staticmap?center={latitud},{longitud}&zoom=17&size=640x400&scale=2&maptype=satellite&markers=color:red%7C{latitud},{longitud}&key={apiKey}";
const configuracion: ConfiguracionMapa = {
  plantillaUrl: plantilla, hostPermitido: "maps.googleapis.com", clave: "clave-ficticia", atribucion: "Google Maps", maxBytes: 32,
};
const pngFirma = Uint8Array.from([137,80,78,71,13,10,26,10]);
const jpegFirma = Uint8Array.from([255,216,255,224]);

test("genera el contrato Google satelital exacto sin enviar la clave al cliente", async () => {
  let solicitada: URL | null = null;
  const resultado = await obtenerMapaEstatico({ latitud:-31.4439167, longitud:-57.9865556 }, configuracion, async (input) => {
    solicitada = new URL(String(input));
    return new Response(pngFirma, { headers:{ "content-type":"image/png" } });
  });
  assert.equal(resultado.estado, "disponible");
  assert.equal(solicitada?.origin, "https://maps.googleapis.com");
  assert.equal(solicitada?.searchParams.get("center"), "-31.443917,-57.986556");
  assert.equal(solicitada?.searchParams.get("markers"), "color:red|-31.443917,-57.986556");
  assert.equal(solicitada?.searchParams.get("maptype"), "satellite");
  assert.equal(solicitada?.searchParams.get("zoom"), "17");
  assert.equal(solicitada?.searchParams.get("size"), "640x400");
  assert.equal(solicitada?.searchParams.get("scale"), "2");
  assert.equal(solicitada?.searchParams.get("key"), "clave-ficticia");
});

test("acepta PNG/JPEG y rechaza proveedor, redirect, MIME, firma y tamaño inválidos", async () => {
  assert.equal((await obtenerMapaEstatico({latitud:0,longitud:0}, configuracion, async()=>new Response(jpegFirma,{headers:{"content-type":"image/jpeg"}}))).estado,"disponible");
  assert.equal((await obtenerMapaEstatico({latitud:0,longitud:0}, configuracion, async()=>new Response(null,{status:403}))).estado,"no-disponible");
  assert.equal((await obtenerMapaEstatico({latitud:0,longitud:0}, configuracion, async()=>new Response(null,{status:302,headers:{location:"https://maps.googleapis.com/otra"}}))).estado,"no-disponible");
  assert.equal((await obtenerMapaEstatico({latitud:0,longitud:0}, {...configuracion,hostPermitido:"otro.example"})).estado,"no-disponible");
  assert.equal((await obtenerMapaEstatico({latitud:0,longitud:0}, configuracion, async()=>new Response(pngFirma,{headers:{"content-type":"text/plain"}}))).estado,"no-disponible");
  assert.equal((await obtenerMapaEstatico({latitud:0,longitud:0}, configuracion, async()=>new Response(Uint8Array.from([1,2,3]),{headers:{"content-type":"image/png"}}))).estado,"no-disponible");
  assert.equal((await obtenerMapaEstatico({latitud:0,longitud:0}, {...configuracion,maxBytes:7}, async()=>new Response(pngFirma,{headers:{"content-type":"image/png"}}))).estado,"no-disponible");
});

test("el timeout se aborta sin filtrar detalles del proveedor", async () => {
  const resultado = await obtenerMapaEstatico({latitud:0,longitud:0},{...configuracion,timeoutMs:1},(_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(new DOMException("Abortado","AbortError")))));
  assert.deepEqual(resultado,{estado:"no-disponible",motivo:"Tiempo de espera agotado"});
});

test("reutiliza durante cinco minutos la misma imagen entre endpoint y PDF", async () => {
  let solicitudes=0;
  const config={...configuracion,cacheMs:300_000};
  const fetchMock:typeof fetch=async()=>{solicitudes++;return new Response(pngFirma,{headers:{"content-type":"image/png"}});};
  await obtenerMapaEstatico({latitud:-32,longitud:-58},config,fetchMock);
  await obtenerMapaEstatico({latitud:-32,longitud:-58},config,fetchMock);
  assert.equal(solicitudes,1);
});

test("el PDF preserva la imagen completa y coloca atribución adicional fuera del mapa", async () => {
  const png=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64"));
  const reporte: ReportePozo = { id_pozo:1,propietario:"Control",empresa:"",perforador:"Control",sitio:"Salto",departamento:"Salto",localidad:"Centro",latitud:"-31",longitud:"-57",fecha_inicio:null,fecha_fin:null,profundidad_final_m:10,nivel_estatico_m:null,nivel_dinamico_m:null,caudal_estimado_lh:null,metodo_sedimentario:null,metodo_rocoso:null,cementacion:null,desarrollo:null,introduccion:null,nombre_archivo:null,foto_url:null,litologia:[],diametros:[],filtros:[],niveles_aporte:[] };
  const {diagnostico}=await crearPDFConDiagnostico(reporte,1,{mapa:{...configuracion,maxBytes:png.length+1},fetchMapa:async()=>new Response(png,{headers:{"content-type":"image/png"}})});
  assert.ok(diagnostico.mapa);
  assert.equal(diagnostico.mapa.overlayOpaco,false);
  assert.ok(diagnostico.mapa.atribucionY < diagnostico.mapa.y);
  assert.ok(diagnostico.mapa.imagenY >= diagnostico.mapa.y);
  assert.ok(diagnostico.mapa.imagenY + diagnostico.mapa.imagenAlto <= diagnostico.mapa.y + diagnostico.mapa.alto + .001);
});
