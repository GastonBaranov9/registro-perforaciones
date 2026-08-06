import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { crearPerfilLitologico, estiloDeCatalogo } from "../src/pdf/perfil-litologico.ts";
import { traducirErrorCatalogo } from "../src/services/litologias-services.ts";

const migracion=fs.readFileSync(new URL("../db/migrations/003_catalogo_litologias.sql",import.meta.url),"utf8");
const semillas=[...migracion.matchAll(/^\('([a-z0-9_]+)','([^']+)','([^']+)','(#[0-9A-F]{6})','([a-z_]+)',(\d+),TRUE\)[,;]$/gm)];

test("la migración define exactamente las 29 litologías válidas y únicas",()=>{
  assert.equal(semillas.length,29);
  assert.equal(new Set(semillas.map((s)=>s[1])).size,29);
  assert.equal(new Set(semillas.map((s)=>s[2].normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase())).size,29);
  assert.ok(semillas.every((s)=>/^#[0-9A-F]{6}$/.test(s[4])));
  const rosada=semillas.find((s)=>s[2]==="Tosca rosada");assert.ok(rosada);const rgb=[1,3,5].map((i)=>Number.parseInt(rosada[4].slice(i,i+2),16));assert.ok(rgb[0]>rgb[1]&&rgb[0]>rgb[2]);
});

test("la migración enlaza por igualdad normalizada y conserva material y desconocidos",()=>{
  assert.match(migracion,/litologia_normalizar\(i\.material\) = c\.nombre_normalizado/);
  assert.doesNotMatch(migracion,/UPDATE intervalo_litologico[\s\S]*SET material/i);
  assert.match(migracion,/ADD COLUMN id_litologia BIGINT/);
  assert.doesNotMatch(migracion,/id_litologia BIGINT NOT NULL/);
});

test("errores duplicados del catálogo son 409 y no filtran detalle SQL",()=>{
  const traducido=traducirErrorCatalogo(Object.assign(new Error("constraint secreta"),{code:"23505"})) as Error&{statusCode:number};
  assert.equal(traducido.statusCode,409);assert.doesNotMatch(traducido.message,/constraint secreta/);
});

test("el perfil canónico usa estilo catalogado y conserva fallback histórico",()=>{
  const perfil=crearPerfilLitologico([{desde_m:0,hasta_m:2,material:"nombre histórico",id_litologia:9,litologia_nombre:"Arenisca blanca",litologia_color:"#E7DDC7",litologia_patron:"sandstone_medium",litologia_activa:false}],2);
  assert.ok(perfil);assert.equal(perfil.tramos[0].estilo.color,"#E7DDC7");assert.equal(perfil.tramos[0].litologia?.activa,false);
  assert.equal(estiloDeCatalogo("#202124","basalt").patron,"diagonal");
});
