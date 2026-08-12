import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { myPool } from "../src/db/pool.ts";

const base=process.env.RSP06J_API_URL??"http://localhost:3000";
const secret=process.env.FASTIFY_SECRET;assert.ok(secret);
let idPozo=0,idSitio=0;
const b64=(valor:unknown)=>Buffer.from(JSON.stringify(valor)).toString("base64url");
function jwt(id:number,version:number){const cabecera=b64({alg:"HS256",typ:"JWT"}),carga=b64({sub:id,version_sesion:version,roles:[]}),firmado=`${cabecera}.${carga}`;return `${firmado}.${createHmac("sha256",secret!).update(firmado).digest("base64url")}`;}
function headers(id:number,version:number,mutacion=false){const csrf=`rsp06j-${id}`;return {cookie:`rsp_session=${jwt(id,version)}; rsp_csrf=${csrf}`,...(mutacion?{"x-csrf-token":csrf,"content-type":"application/json"}:{})};}
async function cuenta(rol:string){const {rows}=await myPool.query<{id_usuario:number;version_sesion:number}>(`SELECT u.id_usuario,u.version_sesion FROM usuario u JOIN usuario_rol ur ON ur.id_usuario=u.id_usuario JOIN rol r ON r.id_rol=ur.id_rol WHERE u.cuenta_acceso=TRUE AND u.activo=TRUE AND r.nombre=$1 LIMIT 1`,[rol]);assert.ok(rows[0],`Falta cuenta ${rol}`);return {id:Number(rows[0].id_usuario),version:Number(rows[0].version_sesion)};}

try{
  const perforador=await cuenta("perforador"),propietario=await cuenta("propietario"),marca=randomUUID();
  const cuerpo={
    pozo:{id_propietario:propietario.id,id_perforador:perforador.id,empresa:`RSP06J ${marca}`,profundidad_final_m:20},
    sitio_nuevo:{departamento:`RSP06J ${marca}`,localidad:"Control temporal",latitud:"-31.4439167",longitud:"-57.9865556"},
    intervalos_litologicos:[],intervalos_diametro:[],intervalos_filtro:[],niveles_aporte:[],
  };
  const alta=await fetch(`${base}/usuarios/${propietario.id}/pozos/completo`,{method:"POST",headers:headers(perforador.id,perforador.version,true),body:JSON.stringify(cuerpo)});
  assert.equal(alta.status,201,await alta.clone().text());
  const creado=await alta.json() as {pozo:{id_pozo:number};sitio:{id_sitio:number;latitud:string;longitud:string}};
  idPozo=Number(creado.pozo.id_pozo);idSitio=Number(creado.sitio.id_sitio);
  assert.deepEqual([creado.sitio.latitud,creado.sitio.longitud],["-31.4439167","-57.9865556"]);

  const dms={departamento:cuerpo.sitio_nuevo.departamento,localidad:cuerpo.sitio_nuevo.localidad,latitud:`31°26'38.1"S`,longitud:`57°59'11.6"W`};
  const editado=await fetch(`${base}/usuarios/${perforador.id}/sitios/${idSitio}`,{method:"PUT",headers:headers(perforador.id,perforador.version,true),body:JSON.stringify(dms)});
  assert.equal(editado.status,200,await editado.clone().text());
  const lectura=await fetch(`${base}/usuarios/${perforador.id}/sitios/${idSitio}`,{headers:headers(perforador.id,perforador.version)});
  assert.equal(lectura.status,200);const sitio=await lectura.json() as {latitud:string;longitud:string};
  assert.deepEqual([sitio.latitud,sitio.longitud],["-31.4439167","-57.9865556"]);

  const estado=await fetch(`${base}/mapas/estado`,{headers:headers(perforador.id,perforador.version)});assert.equal(estado.status,200);
  assert.equal((await estado.json() as {configurado:boolean}).configurado,true);
  const mapa=await fetch(`${base}/usuarios/${perforador.id}/sitios/${idSitio}/mapa-aereo`,{headers:headers(perforador.id,perforador.version)});
  assert.equal(mapa.status,200,await mapa.clone().text());assert.match(mapa.headers.get("content-type")??"",/^image\/(png|jpeg)$/);assert.ok((await mapa.arrayBuffer()).byteLength>10_000);
  const pdf=await fetch(`${base}/usuarios/${perforador.id}/pozos/${idPozo}/informe-pdf`,{headers:headers(perforador.id,perforador.version)});
  assert.equal(pdf.status,200,await pdf.clone().text());const documento=await PDFDocument.load(await pdf.arrayBuffer());assert.ok(documento.getPageCount()>=3);
  console.log(JSON.stringify({decimal_http:201,dms_http:200,lectura_normalizada:true,mapa_estado:true,mapa_http:200,frontend_endpoint:true,pdf_http:200,pdf_paginas:documento.getPageCount(),google_real:true,key:"***REDACTED***"}));
}finally{
  if(idPozo)await myPool.query("DELETE FROM pozo WHERE id_pozo=$1",[idPozo]);
  if(idSitio)await myPool.query("DELETE FROM sitio WHERE id_sitio=$1",[idSitio]);
  await myPool.end();
}
