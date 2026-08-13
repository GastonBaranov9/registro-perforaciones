import assert from "node:assert/strict";
import { myPool } from "../src/db/pool.ts";

const db=await myPool.connect();
try {
  const variantes=["Arena fina","Arena   fina"," Arena fina ","Arena\tfina","Arena\nfina"];
  const {rows:normalizadas}=await db.query<{normalizado:string}>(`SELECT litologia_normalizar(valor) AS normalizado FROM unnest($1::text[]) AS t(valor)`,[variantes]);
  assert.deepEqual(normalizadas.map((fila)=>fila.normalizado),Array(5).fill("arena fina"));
  assert.notEqual((await db.query<{valor:string}>(`SELECT litologia_normalizar($1) AS valor`,["Arena final"])).rows[0].valor,"arena fina");
  assert.equal((await db.query<{cantidad:number}>(`SELECT count(*)::int AS cantidad FROM catalogo_litologia`)).rows[0].cantidad,29);

  await db.query("BEGIN");
  const codigo=`control_r1_${Date.now()}`;
  const {rows:[base]}=await db.query<{id_litologia:string}>(`INSERT INTO catalogo_litologia(codigo,nombre,familia,color,patron,orden) VALUES($1,$2,'otro','#6B625A','granite',999) RETURNING id_litologia`,[codigo,"Arena control R1"]);
  await assert.rejects(()=>db.query(`INSERT INTO catalogo_litologia(codigo,nombre,familia,color,patron,orden) VALUES($1,$2,'otro','#6B625A','granite',1000)`,[`${codigo}_duplicada`,"Arena   control\tR1"]),(error:unknown)=>typeof error==="object"&&error!==null&&"code" in error&&error.code==="23505");
  await db.query("ROLLBACK");

  await db.query("BEGIN");
  const {rows:[catalogada]}=await db.query<{id_litologia:string}>(`SELECT id_litologia FROM catalogo_litologia WHERE codigo='arenisca_fina'`);
  const {rows:[usuario]}=await db.query<{id_usuario:string}>(`INSERT INTO usuario(email,nombre,password,activo) VALUES($1,'Control R1','sin-login',TRUE) RETURNING id_usuario`,[`rsp06h-r1-${Date.now()}@example.invalid`]);
  const {rows:[sitio]}=await db.query<{id_sitio:string}>(`INSERT INTO sitio(departamento,localidad) VALUES('Control','Temporal') RETURNING id_sitio`);
  const {rows:[pozo]}=await db.query<{id_pozo:string}>(`INSERT INTO pozo(id_propietario,id_sitio,id_perforador,creado_por,profundidad_final_m) VALUES($1,$2,$1,$1,10) RETURNING id_pozo`,[usuario.id_usuario,sitio.id_sitio]);
  await db.query(`INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material) VALUES($1,0,10,$2)`,[pozo.id_pozo,"  Arenisca   fina\t"]);
  await db.query(`UPDATE intervalo_litologico i SET id_litologia=c.id_litologia FROM catalogo_litologia c WHERE i.id_pozo=$1 AND litologia_normalizar(i.material)=c.nombre_normalizado`,[pozo.id_pozo]);
  const {rows:[vinculo]}=await db.query<{material:string;id_litologia:string}>(`SELECT material,id_litologia FROM intervalo_litologico WHERE id_pozo=$1`,[pozo.id_pozo]);
  assert.equal(vinculo.id_litologia,catalogada.id_litologia);assert.equal(vinculo.material,"  Arenisca   fina\t");
  await db.query("ROLLBACK");
  console.log(JSON.stringify({variantes_normalizadas:5,resultado:"arena fina",nombres_distintos:true,catalogo:29,duplicado_rechazado:true,historico_vinculado:true,limpieza:"ROLLBACK"}));
} catch(error) { try{await db.query("ROLLBACK");}catch{}throw error; } finally { db.release();await myPool.end(); }
