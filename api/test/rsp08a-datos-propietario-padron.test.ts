import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { myPool } from "../src/db/pool.ts";
import { createSitio, updateSitio } from "../src/services/sitios-service.ts";
import { DEPARTAMENTOS_URUGUAY } from "../src/constants/departamentos-uruguay.ts";
import { crearPDFConDiagnostico } from "../src/pdf/pdf-generate.ts";
import type { ReportePozo } from "../src/services/generar-informe-consultas.ts";

const migracion = fs.readFileSync(new URL("../db/migrations/007_datos_propietario_padron_sitio.sql", import.meta.url), "utf8");

test("migración 007 agrega sólo datos nullable del propietario y padrón textual", () => {
  for (const columna of ["documento_rut", "telefono", "propietario_email", "direccion", "localidad", "departamento", "observaciones"])
    assert.match(migracion, new RegExp(`ADD COLUMN ${columna} (?:VARCHAR|TEXT)`, "i"));
  assert.match(migracion, /ALTER TABLE public\.sitio[\s\S]*ADD COLUMN padron VARCHAR\(80\)/i);
  assert.doesNotMatch(migracion, /NOT NULL|DEFAULT|UPDATE\s+(?:public\.)?usuario|UNIQUE/i);
  assert.doesNotMatch(migracion, /propietario[^\n]*padron/i);
});

test("catálogo canónico contiene exactamente los 19 departamentos con tildes", () => {
  assert.equal(DEPARTAMENTOS_URUGUAY.length, 19);
  assert.equal(new Set(DEPARTAMENTOS_URUGUAY).size, 19);
  for (const valor of ["Paysandú", "Río Negro", "San José", "Tacuarembó", "Treinta y Tres"])
    assert.ok((DEPARTAMENTOS_URUGUAY as readonly string[]).includes(valor));
  for (const valor of DEPARTAMENTOS_URUGUAY) assert.ok(migracion.includes(`'${valor}'`));
});

test("sitio crea, edita y limpia padrón sin tratarlo como número", async () => {
  const consultas:Array<{sql:string;params?:unknown[]}>=[];
  const pool=myPool as typeof myPool&{query:(sql:string,params?:unknown[])=>Promise<{rows:unknown[]}>};
  const original=pool.query;
  pool.query=async(sql,params)=>{consultas.push({sql,params});
    if(sql.includes("SELECT 1"))return{rows:[{ok:1}]};
    return{rows:[{id_sitio:4,departamento:"Salto",localidad:null,latitud:null,longitud:null,padron:params?.at(-1)??null}]};
  };
  try {
    const creado=await createSitio({departamento:"Salto",padron:" 001-AB "});
    assert.equal(creado.padron,"001-AB");assert.equal(consultas[0].params?.at(-1),"001-AB");
    const editado=await updateSitio(4,{departamento:"Salto",padron:"   "});
    assert.equal(editado?.padron,null);assert.equal(consultas.at(-1)?.params?.at(-1),null);
  } finally {pool.query=original;}
});

test("PDF incorpora contacto y padrón compactos sin alterar el layout técnico", async () => {
  const reporte:ReportePozo={
    id_pozo:8,propietario:"Ana Pérez",propietario_documento_rut:"1.234.567-8",propietario_telefono:"+598 99 123 456",
    propietario_email:`ana.${"contacto.".repeat(20)}@example.test`,empresa:"Empresa",perforador:"Perforador",sitio:"Salto",
    departamento:"Salto",localidad:"Centro",latitud:null,longitud:null,padron:"001-A",fecha_inicio:null,fecha_fin:null,
    profundidad_final_m:20,nivel_estatico_m:null,nivel_dinamico_m:null,caudal_estimado_lh:null,metodo_sedimentario:null,
    metodo_rocoso:null,cementacion:null,desarrollo:null,introduccion:null,nombre_archivo:null,foto_url:null,
    litologia:[],diametros:[],filtros:[],niveles_aporte:[],
  };
  const {documento,diagnostico}=await crearPDFConDiagnostico(reporte,8,{mapa:{}});
  assert.ok(documento.getPageCount()>=3);
  for(const tabla of diagnostico.tablas){if(tabla.gapAntesTitulo!==undefined)assert.equal(tabla.gapAntesTitulo,20);assert.equal(tabla.gapDespuesTitulo,7);}
});
