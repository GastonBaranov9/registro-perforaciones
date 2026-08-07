import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { crearPerfilLitologico, dibujarPerfilLitologico, estiloDeCatalogo } from "../src/pdf/perfil-litologico.ts";
import { PDFDocument } from "pdf-lib";
import { traducirErrorCatalogo } from "../src/services/litologias-services.ts";
import { ESPECIFICACION_PATRON, PATRONES_LITOLOGICOS } from "../../recursos/litologia-patrones.ts";

const migracion=fs.readFileSync(new URL("../db/migrations/003_catalogo_litologias.sql",import.meta.url),"utf8");
const semillas=[...migracion.matchAll(/^\('([a-z0-9_]+)','([^']+)','([^']+)','(#[0-9A-F]{6})','([a-z_]+)',(\d+),TRUE\)[,;]$/gm)];

test("la migración define exactamente las 29 litologías válidas y únicas",()=>{
  assert.equal(semillas.length,29);
  assert.equal(new Set(semillas.map((s)=>s[1])).size,29);
  assert.equal(new Set(semillas.map((s)=>s[2].normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase())).size,29);
  assert.ok(semillas.every((s)=>/^#[0-9A-F]{6}$/.test(s[4])));
  const rosada=semillas.find((s)=>s[2]==="Tosca rosada");assert.ok(rosada);const rgb=[1,3,5].map((i)=>Number.parseInt(rosada[4].slice(i,i+2),16));assert.ok(rgb[0]>rgb[1]&&rgb[0]>rgb[2]);
  assert.ok(semillas.every((s)=>PATRONES_LITOLOGICOS.includes(s[5] as typeof PATRONES_LITOLOGICOS[number])));
  assert.equal(Object.keys(ESPECIFICACION_PATRON).length,12);
  assert.ok(semillas.filter((s)=>s[2].toLocaleLowerCase().includes('rosad')).every((s)=>Number.parseInt(s[4].slice(1,3),16)>Number.parseInt(s[4].slice(3,5),16)));
});

test("la migración enlaza por igualdad normalizada y conserva material y desconocidos",()=>{
  assert.match(migracion,/litologia_normalizar\(i\.material\) = c\.nombre_normalizado/);
  assert.doesNotMatch(migracion,/UPDATE intervalo_litologico[\s\S]*SET material/i);
  assert.match(migracion,/ADD COLUMN id_litologia BIGINT/);
  assert.doesNotMatch(migracion,/id_litologia BIGINT NOT NULL/);
});

test("la normalización SQL usa una sola barra para compactar separaciones",()=>{
  assert.match(migracion,/regexp_replace\(valor, '\\s\+', ' ', 'g'\)/);
  assert.doesNotMatch(migracion,/regexp_replace\(valor, '\\\\s\+'/);
});

test("errores duplicados del catálogo son 409 y no filtran detalle SQL",()=>{
  const traducido=traducirErrorCatalogo(Object.assign(new Error("constraint secreta"),{code:"23505"})) as Error&{statusCode:number};
  assert.equal(traducido.statusCode,409);assert.doesNotMatch(traducido.message,/constraint secreta/);
});

test("el perfil canónico usa estilo catalogado y conserva fallback histórico",()=>{
  const perfil=crearPerfilLitologico([{desde_m:0,hasta_m:2,material:"nombre histórico",id_litologia:9,litologia_nombre:"Arenisca blanca",litologia_color:"#E7DDC7",litologia_patron:"sandstone_medium",litologia_activa:false}],2);
  assert.ok(perfil);assert.equal(perfil.tramos[0].estilo.color,"#E7DDC7");assert.equal(perfil.tramos[0].litologia?.activa,false);
  assert.equal(estiloDeCatalogo("#202124","basalt").patron,"basalt");
});

test("las 12 claves tienen modelo compartido y render PDF disponible",async()=>{
  for (const [indice,patron] of PATRONES_LITOLOGICOS.entries()) {
    const perfil=crearPerfilLitologico([{desde_m:0,hasta_m:1,material:`Material ${patron}`,id_litologia:indice+1,litologia_nombre:`Material ${patron}`,litologia_color:"#A98B72",litologia_patron:patron,litologia_activa:false}],1);
    assert.ok(perfil); assert.equal(perfil.tramos[0].estilo.patron,patron); assert.ok(ESPECIFICACION_PATRON[patron].paso>0);
    const doc=await PDFDocument.create(); const font=await doc.embedFont('Helvetica');
    dibujarPerfilLitologico(doc,perfil,font,font); assert.equal(doc.getPageCount(),1);
  }
});
