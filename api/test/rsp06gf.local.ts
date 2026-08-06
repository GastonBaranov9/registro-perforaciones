import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { myPool } from "../src/db/pool.ts";
import rutas from "../src/routes/intervalos-diametro-perforaciones.ts";
import { getReportePozo } from "../src/services/generar-informe-consultas.ts";
import { generarPDFBytes } from "../src/pdf/pdf-generate.ts";

const usuarios:number[]=[];let idPozo:number|null=null;
try {
  const roles=await myPool.query("SELECT id_rol,nombre FROM rol WHERE nombre=ANY($1::text[])",[["propietario","perforador"]]);
  const sitio=await myPool.query("SELECT id_sitio FROM sitio ORDER BY id_sitio LIMIT 1");
  for(const nombre of ["propietario","perforador"]){
    const rol=Number(roles.rows.find((r)=>r.nombre===nombre)?.id_rol);if(!rol||!sitio.rows[0])throw new Error("Faltan catálogos");
    const u=await myPool.query("INSERT INTO usuario(email,nombre,password,activo) VALUES($1,$2,$3,true) RETURNING id_usuario",[`rsp06gf-${randomUUID()}@example.invalid`,`Temporal ${nombre}`,"hash-no-utilizable"]);
    const id=Number(u.rows[0].id_usuario);usuarios.push(id);await myPool.query("INSERT INTO usuario_rol(id_usuario,id_rol)VALUES($1,$2)",[id,rol]);
  }
  const p=await myPool.query("INSERT INTO pozo(id_propietario,id_perforador,id_sitio,creado_por,profundidad_final_m)VALUES($1,$2,$3,$2,30)RETURNING id_pozo",[usuarios[0],usuarios[1],Number(sitio.rows[0].id_sitio)]);idPozo=Number(p.rows[0].id_pozo);
  const d=await myPool.query("INSERT INTO intervalo_diametro_perforacion(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia)VALUES($1,0,10,8,'PVC'),($1,15,25,6,'Acero')RETURNING id_intervalo_diametro_perforacion",[idPozo]);const id=Number(d.rows[0].id_intervalo_diametro_perforacion);
  const app=Fastify();app.decorate("authenticate",async()=>undefined);app.decorate("pozoIsFromUser",async()=>undefined);app.decorate("userIsAdminOrPerforador",async()=>undefined);app.decorate("userIsPropietarioOrPerforadorOrAdmin",async()=>undefined);await app.register(rutas);await app.ready();
  const base=`/usuarios/${usuarios[0]}/pozos/${idPozo}/intervalo_diametro_perforacion`;
  const put=(identificador:number,payload:object)=>app.inject({method:"PUT",url:`${base}/${identificador}`,payload});
  assert.equal((await put(id,{desde_m:1,hasta_m:9,diametro_pulg:7,material_tuberia:"PVC"})).statusCode,200);
  assert.equal((await put(id,{desde_m:16,hasta_m:20,diametro_pulg:7,material_tuberia:"PVC"})).statusCode,400);
  assert.equal((await put(id,{desde_m:20,hasta_m:31,diametro_pulg:7,material_tuberia:"PVC"})).statusCode,400);
  assert.equal((await put(999999999,{desde_m:1,hasta_m:2,diametro_pulg:7,material_tuberia:"PVC"})).statusCode,404);await app.close();
  const vigente=await myPool.query("SELECT desde_m,hasta_m,diametro_pulg,material_tuberia FROM intervalo_diametro_perforacion WHERE id_intervalo_diametro_perforacion=$1",[id]);assert.deepEqual(vigente.rows,[{desde_m:"1",hasta_m:"9",diametro_pulg:"7",material_tuberia:"PVC"}]);
  const reporte=await getReportePozo(idPozo);assert.ok(reporte);assert.ok((await generarPDFBytes(reporte,idPozo)).length>1000);
  console.log(JSON.stringify({ejecutada:true,valida200:true,solapamiento400:true,profundidad400:true,inexistente404:true,noPersistioRechazos:true,pdf:true}));
} finally {if(idPozo)await myPool.query("DELETE FROM pozo WHERE id_pozo=$1",[idPozo]);for(const id of usuarios.reverse())await myPool.query("DELETE FROM usuario WHERE id_usuario=$1",[id]);await myPool.end();}
