import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { myPool } from "../src/db/pool.ts";
import rutasFiltros from "../src/routes/intervalos-filtro.ts";
import { reemplazarFotoReversible, purgarFotoConfirmada } from "../src/services/foto-archivo-service.ts";
import { getReportePozo } from "../src/services/generar-informe-consultas.ts";
import { generarPDFBytes } from "../src/pdf/pdf-generate.ts";

const fotos=path.resolve("public");
const usuarios:number[]=[];
let idPozo:number|null=null;
let idFiltro:number|null=null;
const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
try{
  const roles=await myPool.query("SELECT id_rol,nombre FROM rol WHERE nombre=ANY($1::text[])",[["propietario","perforador"]]);
  const sitio=await myPool.query("SELECT id_sitio FROM sitio ORDER BY id_sitio LIMIT 1");
  for(const nombre of ["propietario","perforador"]){
    const idRol=Number(roles.rows.find((r)=>r.nombre===nombre)?.id_rol);if(!idRol||!sitio.rows[0])throw new Error("Faltan catálogos locales");
    const u=await myPool.query("INSERT INTO usuario(email,nombre,password,activo) VALUES($1,$2,$3,true) RETURNING id_usuario",[`rsp06gd-${randomUUID()}@example.invalid`,`Temporal ${nombre}`,"hash-no-utilizable"]);
    const id=Number(u.rows[0].id_usuario);usuarios.push(id);await myPool.query("INSERT INTO usuario_rol(id_usuario,id_rol) VALUES($1,$2)",[id,idRol]);
  }
  const p=await myPool.query("INSERT INTO pozo(id_propietario,id_perforador,id_sitio,creado_por,empresa,profundidad_final_m,foto_url) VALUES($1,$2,$3,$2,$4,30,$5) RETURNING id_pozo",[usuarios[0],usuarios[1],Number(sitio.rows[0].id_sitio),"TEMPORAL RSP06GD","/foto"]);
  idPozo=Number(p.rows[0].id_pozo);await fs.mkdir(fotos,{recursive:true});await fs.writeFile(path.join(fotos,`pozo-${idPozo}.jpg`),Buffer.from([0xff,0xd8,0xff,0x01]));
  const f=await myPool.query("INSERT INTO intervalo_filtro(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES($1,5,10,6,'PVC') RETURNING id_intervalo_filtro",[idPozo]);idFiltro=Number(f.rows[0].id_intervalo_filtro);
  await assert.rejects(reemplazarFotoReversible(idPozo,fotos,{buffer:png,extension:"png"},async(url)=>myPool.query("UPDATE pozo SET foto_url=$2 WHERE id_pozo=$1",[idPozo,url]),"/foto-nueva",{promover:async()=>{throw Object.assign(new Error("controlado"),{code:"EIO"});}}));
  assert.deepEqual((await myPool.query("SELECT foto_url FROM pozo WHERE id_pozo=$1",[idPozo])).rows,[{foto_url:"/foto"}]);await fs.access(path.join(fotos,`pozo-${idPozo}.jpg`));
  const reemplazo=await reemplazarFotoReversible(idPozo,fotos,{buffer:png,extension:"png"},async(url)=>{await myPool.query("UPDATE pozo SET foto_url=$2 WHERE id_pozo=$1",[idPozo,url]);return true;},"/foto-nueva");
  assert.equal(await purgarFotoConfirmada(reemplazo.anterior,idPozo,"prueba",{warn:()=>undefined},async()=>{throw Object.assign(new Error("controlado"),{code:"EACCES"});}),false);await fs.access(path.join(fotos,`pozo-${idPozo}.png`));
  const app=Fastify();app.decorate("authenticate",async()=>undefined);app.decorate("pozoIsFromUser",async()=>undefined);app.decorate("userIsAdminOrPerforador",async()=>undefined);app.decorate("userIsPropietarioOrPerforadorOrAdmin",async()=>undefined);await app.register(rutasFiltros);await app.ready();
  const base=`/usuarios/${usuarios[0]}/pozos/${idPozo}/intervalos_filtro`;
  assert.equal((await app.inject({method:"PUT",url:`${base}/${idFiltro}`,payload:{desde_m:8,hasta_m:12,diametro_pulg:6,material_tuberia:"PVC"}})).statusCode,200);
  await myPool.query("INSERT INTO intervalo_filtro(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES($1,15,20,6,'PVC')",[idPozo]);
  assert.equal((await app.inject({method:"PUT",url:`${base}/${idFiltro}`,payload:{desde_m:16,hasta_m:19,diametro_pulg:6,material_tuberia:"PVC"}})).statusCode,400);
  assert.equal((await app.inject({method:"PUT",url:`${base}/${idFiltro}`,payload:{desde_m:25,hasta_m:31,diametro_pulg:6,material_tuberia:"PVC"}})).statusCode,400);
  assert.equal((await app.inject({method:"PUT",url:`${base}/999999999`,payload:{desde_m:1,hasta_m:2,diametro_pulg:6,material_tuberia:"PVC"}})).statusCode,404);await app.close();
  const reporte=await getReportePozo(idPozo);assert.ok(reporte);assert.ok((await generarPDFBytes(reporte,idPozo)).length>1000);
  console.log(JSON.stringify({ejecutada:true,restauracion:true,reemplazo:true,purgaPostCommit:true,filtroValido:true,solapamiento400:true,profundidad400:true,inexistente404:true,pdf:true}));
}finally{
  if(idPozo)await myPool.query("DELETE FROM pozo WHERE id_pozo=$1",[idPozo]);for(const id of usuarios.reverse())await myPool.query("DELETE FROM usuario WHERE id_usuario=$1",[id]);
  if(idPozo){for(const n of await fs.readdir(fotos).catch(()=>[]))if(n.startsWith(`pozo-${idPozo}.`))await fs.rm(path.join(fotos,n),{force:true});const t=path.join(fotos,".trash");for(const n of await fs.readdir(t).catch(()=>[]))if(n.startsWith(`${idPozo}-`)||n.includes(`-${idPozo}-`))await fs.rm(path.join(t,n),{force:true});}
  await myPool.end();
}
