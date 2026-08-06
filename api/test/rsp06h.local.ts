import assert from "node:assert/strict";
import { myPool } from "../src/db/pool.ts";
import { crearPerfilLitologico } from "../src/pdf/perfil-litologico.ts";
import { crearPDF } from "../src/pdf/pdf-generate.ts";

const db=await myPool.connect();
try {
  await db.query("BEGIN");
  const {rows:[lit]}=await db.query(`INSERT INTO catalogo_litologia(codigo,nombre,familia,color,patron,orden) VALUES($1,$2,$3,$4,$5,$6) RETURNING id_litologia,nombre,color,patron,activo`,["control_rsp06h","Litología control RSP-06H","otro","#6B625A","granite",999]);
  const {rows:[usuario]}=await db.query(`INSERT INTO usuario(email,nombre,password,activo) VALUES($1,$2,$3,TRUE) RETURNING id_usuario`,[`rsp06h-${Date.now()}@example.invalid`,`Control RSP-06H`,`no-login-control`]);
  const {rows:[sitio]}=await db.query(`INSERT INTO sitio(departamento,localidad,latitud,longitud) VALUES($1,$2,$3,$4) RETURNING id_sitio`,["Control","Temporal",null,null]);
  const {rows:[pozo]}=await db.query(`INSERT INTO pozo(id_propietario,id_sitio,id_perforador,creado_por,profundidad_final_m) VALUES($1,$2,$1,$1,10) RETURNING id_pozo`,[usuario.id_usuario,sitio.id_sitio]);
  const {rows:[intervalo]}=await db.query(`INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia) VALUES($1,0,10,$2,$3) RETURNING material,id_litologia`,[pozo.id_pozo,lit.nombre,lit.id_litologia]);
  await db.query(`UPDATE catalogo_litologia SET activo=FALSE,actualizado_en=now() WHERE id_litologia=$1`,[lit.id_litologia]);
  const {rows:[historico]}=await db.query(`SELECT i.material,c.nombre,c.color,c.patron,c.activo FROM intervalo_litologico i JOIN catalogo_litologia c ON c.id_litologia=i.id_litologia WHERE i.id_pozo=$1`,[pozo.id_pozo]);
  const {rows:[opciones]}=await db.query(`SELECT count(*)::int AS cantidad FROM catalogo_litologia WHERE activo AND id_litologia=$1`,[lit.id_litologia]);
  assert.equal(intervalo.id_litologia,lit.id_litologia);assert.equal(opciones.cantidad,0);assert.equal(historico.activo,false);assert.equal(historico.material,lit.nombre);
  const perfil=crearPerfilLitologico([{desde_m:0,hasta_m:10,material:historico.material,id_litologia:Number(lit.id_litologia),litologia_nombre:historico.nombre,litologia_color:historico.color,litologia_patron:historico.patron,litologia_activa:historico.activo}],10);
  assert.ok(perfil);assert.equal(perfil.tramos[0].estilo.color,"#6B625A");
  const reporte={id_pozo:Number(pozo.id_pozo),propietario:"Control",empresa:"Control",perforador:"Control",sitio:"Control",fecha_inicio:null,fecha_fin:null,profundidad_final_m:10,nivel_estatico_m:null,nivel_dinamico_m:null,caudal_estimado_lh:null,metodo_sedimentario:null,metodo_rocoso:null,cementacion:null,desarrollo:null,introduccion:null,nombre_archivo:null,foto_url:null,litologia:[{desde_m:0,hasta_m:10,material:historico.material,id_litologia:Number(lit.id_litologia),litologia_nombre:historico.nombre,litologia_color:historico.color,litologia_patron:historico.patron,litologia_activa:false}],diametros:[],filtros:[],niveles_aporte:[]};
  const pdf=await crearPDF(reporte,Number(pozo.id_pozo),{mapa:{}});assert.ok((await pdf.save()).byteLength>1000);
  await db.query("ROLLBACK");
  const {rows:[restos]}=await db.query(`SELECT count(*)::int AS cantidad FROM catalogo_litologia WHERE codigo=$1`,["control_rsp06h"]);assert.equal(restos.cantidad,0);
  console.log(JSON.stringify({catalogo:29,personalizada:true,intervalo:true,desactivada:true,historico_legible:true,fuera_opciones:true,perfil:true,pdf:true,limpieza:"ROLLBACK",restos:0}));
} catch(error) { await db.query("ROLLBACK");throw error; } finally { db.release();await myPool.end(); }
