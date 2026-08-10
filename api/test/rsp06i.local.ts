import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { myPool } from "../src/db/pool.ts";
import { hashPassword } from "../src/services/password-service.ts";

const base=process.env.RSP06I_API_URL??"http://localhost:3000";const sufijo=randomUUID();
const emailPerforador=`rsp06i-perf-${sufijo}@example.invalid`,clave="Control RSP06I 2026";
let idPerforador=0,idPropietario=0,idPozo=0,idSitio=0;let cookie="",csrf="";
async function http(ruta:string,init:RequestInit={}){const headers=new Headers(init.headers);if(cookie)headers.set("cookie",cookie);if(csrf&&!['GET','HEAD'].includes(init.method??'GET'))headers.set("x-csrf-token",csrf);if(init.body)headers.set("content-type","application/json");return fetch(`${base}${ruta}`,{...init,headers});}
try{
  const rol=(await myPool.query<{id_rol:number}>("SELECT id_rol FROM rol WHERE nombre=$1",["perforador"])).rows[0];assert.ok(rol);
  const creado=await myPool.query<{id_usuario:number}>("INSERT INTO usuario(email,nombre,password,activo) VALUES($1,$2,$3,TRUE) RETURNING id_usuario",[emailPerforador,"Perforador control RSP-06I",await hashPassword(clave)]);idPerforador=Number(creado.rows[0].id_usuario);
  await myPool.query("INSERT INTO usuario_rol(id_usuario,id_rol) VALUES($1,$2)",[idPerforador,rol.id_rol]);
  const login=await fetch(`${base}/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:emailPerforador,password:clave})});assert.equal(login.status,200);
  const setCookies=login.headers.getSetCookie();cookie=setCookies.map(x=>x.split(';')[0]).join('; ');csrf=decodeURIComponent((setCookies.find(x=>x.startsWith('rsp_csrf='))??'').split(';')[0].split('=')[1]??'');assert.ok(cookie.includes("rsp_session=")&&csrf);
  const catalogos=await http("/pozos/candidatos-personas");assert.equal(catalogos.status,200);const personas=await catalogos.json() as {propietarios:unknown[];perforadores:Array<{id_usuario:number}>};assert.equal(personas.propietarios.length,0);assert.deepEqual(personas.perforadores.map(x=>x.id_usuario),[idPerforador]);
  const alta=await http("/pozos/propietarios",{method:"POST",body:JSON.stringify({nombre:"Propietario control RSP-06I",email:`rsp06i-prop-${sufijo}@example.invalid`})});assert.equal(alta.status,201);const propietario=await alta.json() as {id_usuario:number;nombre:string;roles:string[]};idPropietario=propietario.id_usuario;assert.deepEqual(propietario.roles,["propietario"]);
  const cuerpo={pozo:{id_propietario:idPropietario,id_perforador:idPerforador,empresa:"Empresa control RSP-06I",profundidad_final_m:50,sello_sanitario:true,nivel_estatico_m:8,nivel_dinamico_m:12,caudal_estimado_lh:1800,pre_filtro:"Grava",revestimiento:"PVC: 6",metodo_sedimentario:"Rotación",metodo_rocoso:"Percusión",cementacion:"Registrada",desarrollo:"Registrado"},sitio_nuevo:{departamento:`Control RSP06I ${sufijo}`,localidad:"Ubicación temporal",latitud:"-31.388123",longitud:"-57.960456"},intervalos_litologicos:Array.from({length:5},(_,i)=>({desde_m:i*10,hasta_m:(i+1)*10,material:`Material control ${i}`})),intervalos_diametro:[{desde_m:0,hasta_m:25,diametro_pulg:8,material_tuberia:"Acero"},{desde_m:25,hasta_m:50,diametro_pulg:6,material_tuberia:"PVC"}],intervalos_filtro:[{desde_m:30,hasta_m:40,diametro_pulg:6,material_tuberia:"PVC"}],niveles_aporte:[{profundidad_m:22},{profundidad_m:38}]};
  const fallo=structuredClone(cuerpo);fallo.sitio_nuevo.departamento=`Rollback RSP06I ${sufijo}`;fallo.intervalos_litologicos[0].id_litologia=99999999;const rechazado=await http(`/usuarios/${idPropietario}/pozos/completo`,{method:"POST",body:JSON.stringify(fallo)});assert.equal(rechazado.status,400,await rechazado.clone().text());assert.equal(Number((await myPool.query("SELECT count(*)::int cantidad FROM sitio WHERE departamento=$1",[fallo.sitio_nuevo.departamento])).rows[0].cantidad),0);
  const altaPozo=await http(`/usuarios/${idPropietario}/pozos/completo`,{method:"POST",body:JSON.stringify(cuerpo)});assert.equal(altaPozo.status,201);const resultado=await altaPozo.json() as {pozo:{id_pozo:number};sitio:{id_sitio:number}};idPozo=resultado.pozo.id_pozo;idSitio=resultado.sitio.id_sitio;
  const legacy=await http(`/usuarios/${idPropietario}/pozos`,{method:"POST",body:JSON.stringify({...cuerpo.pozo,id_sitio:idSitio})});assert.equal(legacy.status,400);
  const edicionPozo={pozo:{...cuerpo.pozo,id_sitio:99999999},intervalos_litologicos:cuerpo.intervalos_litologicos,intervalos_diametro:cuerpo.intervalos_diametro,intervalos_filtro:cuerpo.intervalos_filtro,niveles_aporte:cuerpo.niveles_aporte,foto_accion:"conservar"};
  const actualizado=await http(`/usuarios/${idPerforador}/pozos/${idPozo}/completo`,{method:"PUT",body:JSON.stringify(edicionPozo)});assert.equal(actualizado.status,200,await actualizado.clone().text());const pozoActualizado=await actualizado.json() as {pozo:{id_sitio:number};sitio:{id_sitio:number}};assert.equal(pozoActualizado.pozo.id_sitio,idSitio);assert.equal(pozoActualizado.sitio.id_sitio,idSitio);
  const detalle=await http(`/usuarios/${idPerforador}/pozos/${idPozo}`);assert.equal(detalle.status,200);const humano=await detalle.json() as {propietario_nombre:string;perforador_nombre:string;sitio:{departamento:string;latitud:string};id_propietario:number};assert.equal(humano.propietario_nombre,"Propietario control RSP-06I");assert.equal(humano.perforador_nombre,"Perforador control RSP-06I");assert.equal(humano.sitio.departamento,cuerpo.sitio_nuevo.departamento);
  const ubicacionNueva={...cuerpo.sitio_nuevo,latitud:"-31.400000",longitud:"-57.970000"};const editarSitio=await http(`/usuarios/${idPerforador}/sitios/${idSitio}`,{method:"PUT",body:JSON.stringify(ubicacionNueva)});assert.equal(editarSitio.status,200);
  const estadoMapa=await http("/mapas/estado");assert.equal(estadoMapa.status,200);const mapa=await estadoMapa.json() as {configurado:boolean};
  const imagenMapa=await http(`/usuarios/${idPerforador}/sitios/${idSitio}/mapa-aereo`);assert.equal(imagenMapa.status,mapa.configurado?200:503);
  const pdf=await http(`/usuarios/${idPerforador}/pozos/${idPozo}/informe-pdf`);assert.equal(pdf.status,200);assert.match(pdf.headers.get("content-type")??"",/application\/pdf/);const documento=await PDFDocument.load(await pdf.arrayBuffer());assert.ok(documento.getPageCount()>=3);
  console.log(JSON.stringify({login:200,candidatos_iniciales:0,perforador_predeterminado:idPerforador,propietario:201,sitio_pozo_atomico:201,rollback_sitio:true,legacy_rechazado:400,edicion_conserva_sitio:true,detalle_humano:true,edicion_ubicacion:200,mapa_configurado:mapa.configurado,mapa_http:imagenMapa.status,pdf_paginas:documento.getPageCount()}));
}finally{
  if(idPozo)await myPool.query("DELETE FROM pozo WHERE id_pozo=$1",[idPozo]);
  if(idSitio)await myPool.query("DELETE FROM sitio WHERE id_sitio=$1",[idSitio]);
  if(idPropietario)await myPool.query("DELETE FROM usuario WHERE id_usuario=$1",[idPropietario]);
  if(idPerforador)await myPool.query("DELETE FROM usuario WHERE id_usuario=$1",[idPerforador]);
  await myPool.end();
}
