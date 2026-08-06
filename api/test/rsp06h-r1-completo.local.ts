import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { myPool } from "../src/db/pool.ts";
import { actualizarPozoCompleto, crearPozoCompleto } from "../src/services/pozo-completo-service.ts";
import { listIntervalosLitologicosByPozo } from "../src/services/intervalos-litologicos-services.ts";
import { crearPerfilLitologico } from "../src/pdf/perfil-litologico.ts";
import { crearPDF } from "../src/pdf/pdf-generate.ts";
import type { PozoCompletoBody, PozoCompletoUpdateBody } from "../src/models/schemas.ts";

const cuatrocientos=async(promesa:Promise<unknown>)=>assert.rejects(promesa,(error:unknown)=>error instanceof Error&&(error as Error&{statusCode?:number}).statusCode===400&&error.name!=="TypeError");
const {rows:[usuario]}=await myPool.query<{id_usuario:number}>(`INSERT INTO usuario(email,nombre,password,activo) VALUES('completo-r1@example.invalid','Control completo','sin-login',TRUE) RETURNING id_usuario`);
const {rows:roles}=await myPool.query<{id_rol:number}>(`INSERT INTO rol(nombre,descr) VALUES('propietario','Control'),('perforador','Control') RETURNING id_rol`);
for(const rol of roles)await myPool.query(`INSERT INTO usuario_rol(id_usuario,id_rol) VALUES($1,$2)`,[usuario.id_usuario,rol.id_rol]);
const {rows:[sitio]}=await myPool.query<{id_sitio:number}>(`INSERT INTO sitio(departamento,localidad) VALUES('Control','Temporal') RETURNING id_sitio`);
const {rows:[activa]}=await myPool.query<{id_litologia:number}>(`SELECT id_litologia FROM catalogo_litologia WHERE codigo='arenisca_fina'`);
const {rows:[personalizada]}=await myPool.query<{id_litologia:number}>(`INSERT INTO catalogo_litologia(codigo,nombre,familia,color,patron,orden) VALUES('control_completo_r1','Control completo R1','otro','#6B625A','granite',999) RETURNING id_litologia`);
const dir=path.join(os.tmpdir(),"rsp06h-r1-completo-sin-fotos");
const cuerpo=(id_litologia:number,empresa:string):PozoCompletoBody=>({pozo:{id_propietario:usuario.id_usuario,id_perforador:usuario.id_usuario,id_sitio:sitio.id_sitio,profundidad_final_m:10,empresa},intervalos_litologicos:[{desde_m:0,hasta_m:10,material:"Control",id_litologia}],intervalos_diametro:[],intervalos_filtro:[],niveles_aporte:[]});

try {
  const creado=await crearPozoCompleto(usuario.id_usuario,cuerpo(activa.id_litologia,"Activa"),dir);
  assert.equal(creado.intervalos_litologicos[0].id_litologia,Number(activa.id_litologia));
  const antesInvalido=(await myPool.query<{cantidad:number}>(`SELECT count(*)::int AS cantidad FROM pozo`)).rows[0].cantidad;
  await cuatrocientos(crearPozoCompleto(usuario.id_usuario,cuerpo(9_999_999,"Inexistente"),dir));
  assert.equal((await myPool.query<{cantidad:number}>(`SELECT count(*)::int AS cantidad FROM pozo`)).rows[0].cantidad,antesInvalido);

  const historico=await crearPozoCompleto(usuario.id_usuario,cuerpo(personalizada.id_litologia,"Histórico"),dir);
  await myPool.query(`UPDATE catalogo_litologia SET activo=FALSE WHERE id_litologia=$1`,[personalizada.id_litologia]);
  await cuatrocientos(crearPozoCompleto(usuario.id_usuario,cuerpo(personalizada.id_litologia,"Inactiva"),dir));
  const previos=await listIntervalosLitologicosByPozo(historico.pozo.id_pozo);
  assert.equal(previos[0].litologia_activa,false);
  const edicion=(id_litologia:number):PozoCompletoUpdateBody=>({...cuerpo(id_litologia,"Intento edición"),foto_accion:"conservar"});
  await cuatrocientos(actualizarPozoCompleto(historico.pozo.id_pozo,edicion(9_999_999),dir));
  await cuatrocientos(actualizarPozoCompleto(historico.pozo.id_pozo,edicion(personalizada.id_litologia),dir));
  const despues=await listIntervalosLitologicosByPozo(historico.pozo.id_pozo);
  assert.equal(despues.length,1);assert.equal(Number(despues[0].id_litologia),Number(personalizada.id_litologia));assert.equal(despues[0].litologia_activa,false);
  assert.equal((await myPool.query<{empresa:string}>(`SELECT empresa FROM pozo WHERE id_pozo=$1`,[historico.pozo.id_pozo])).rows[0].empresa,"Histórico");

  const entrada={desde_m:0,hasta_m:10,material:String(despues[0].material),id_litologia:Number(despues[0].id_litologia),litologia_nombre:String(despues[0].litologia_nombre),litologia_color:String(despues[0].litologia_color),litologia_patron:despues[0].litologia_patron as "granite",litologia_activa:false};
  const perfil=crearPerfilLitologico([entrada],10);assert.ok(perfil);assert.equal(perfil.tramos[0].litologia?.activa,false);
  const reporte={id_pozo:historico.pozo.id_pozo,propietario:"Control",empresa:"Histórico",perforador:"Control",sitio:"Control",fecha_inicio:null,fecha_fin:null,profundidad_final_m:10,nivel_estatico_m:null,nivel_dinamico_m:null,caudal_estimado_lh:null,metodo_sedimentario:null,metodo_rocoso:null,cementacion:null,desarrollo:null,introduccion:null,nombre_archivo:null,foto_url:null,litologia:[entrada],diametros:[],filtros:[],niveles_aporte:[]};
  assert.ok((await (await crearPDF(reporte,historico.pozo.id_pozo,{mapa:{}})).save()).byteLength>1000);
  const desconocido=await crearPozoCompleto(usuario.id_usuario,{...cuerpo(activa.id_litologia,"Desconocido"),intervalos_litologicos:[{desde_m:0,hasta_m:10,material:"Valor histórico desconocido"}]},dir);assert.equal(desconocido.intervalos_litologicos[0].id_litologia,null);
  console.log(JSON.stringify({creacion_activa:201,creacion_inexistente:400,creacion_inactiva:400,edicion_inexistente:400,edicion_inactiva:400,rollback_edicion:true,historico_inactivo:true,desconocido_null:true,perfil:true,pdf:true}));
} finally { await myPool.end(); }
