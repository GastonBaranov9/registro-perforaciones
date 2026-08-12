import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { myPool } from "../src/db/pool.ts";
import { DATOS_TECNICOS_ESTANDAR } from "../src/constants/datos-tecnicos-estandar.ts";

const base = process.env.RSP06K_API_URL ?? "http://localhost:3000";
const secret = process.env.FASTIFY_SECRET; assert.ok(secret);
let idPozo = 0, idSitio = 0;
const b64 = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString("base64url");
function jwt(id:number, version:number) { const h=b64({alg:"HS256",typ:"JWT"}),p=b64({sub:id,version_sesion:version,roles:[]}),f=`${h}.${p}`; return `${f}.${createHmac("sha256",secret!).update(f).digest("base64url")}`; }
function headers(id:number,version:number,mutacion=false) { const csrf=`rsp06k-${id}`; return {cookie:`rsp_session=${jwt(id,version)}; rsp_csrf=${csrf}`,...(mutacion?{"x-csrf-token":csrf,"content-type":"application/json"}:{})}; }
async function cuenta(rol:string) { const {rows}=await myPool.query<{id_usuario:number;version_sesion:number}>(`SELECT u.id_usuario,u.version_sesion FROM usuario u JOIN usuario_rol ur ON ur.id_usuario=u.id_usuario JOIN rol r ON r.id_rol=ur.id_rol WHERE u.cuenta_acceso=TRUE AND u.activo=TRUE AND r.nombre=$1 LIMIT 1`,[rol]); assert.ok(rows[0]); return {id:Number(rows[0].id_usuario),version:Number(rows[0].version_sesion)}; }

try {
  const perforador=await cuenta("perforador"), propietario=await cuenta("propietario"), marca=randomUUID();
  const cuerpo={
    pozo:{id_propietario:propietario.id,id_perforador:perforador.id,empresa:`RSP06K ${marca}`,profundidad_final_m:30},
    sitio_nuevo:{departamento:`RSP06K ${marca}`,localidad:"Temporal",latitud:"-31.4439167",longitud:"-57.9865556"},
    intervalos_litologicos:[],intervalos_diametro:[],
    intervalos_filtro:[{desde_m:10,hasta_m:15,diametro_pulg:6,material_tuberia:"PVC",ranura_mm:0.75}],niveles_aporte:[],
  };
  for (const ranura_mm of [undefined,0.6]) {
    const invalido=structuredClone(cuerpo) as typeof cuerpo & {intervalos_filtro:Array<Record<string,unknown>>};
    if (ranura_mm === undefined) delete invalido.intervalos_filtro[0].ranura_mm;
    else invalido.intervalos_filtro[0].ranura_mm=ranura_mm;
    const rechazo=await fetch(`${base}/usuarios/${propietario.id}/pozos/completo`,{method:"POST",headers:headers(perforador.id,perforador.version,true),body:JSON.stringify(invalido)});
    assert.equal(rechazo.status,400);
  }
  const alta=await fetch(`${base}/usuarios/${propietario.id}/pozos/completo`,{method:"POST",headers:headers(perforador.id,perforador.version,true),body:JSON.stringify(cuerpo)});
  assert.equal(alta.status,201,await alta.clone().text());
  const creado=await alta.json() as {pozo:Record<string,unknown>&{id_pozo:number};sitio:{id_sitio:number};intervalos_filtro:Array<{id_intervalo_filtro:number;ranura_mm:number}>};
  idPozo=Number(creado.pozo.id_pozo); idSitio=Number(creado.sitio.id_sitio);
  for (const [campo,valor] of Object.entries(DATOS_TECNICOS_ESTANDAR)) assert.equal(creado.pozo[campo],valor);
  assert.equal(creado.intervalos_filtro[0].ranura_mm,0.75);

  const historico=await myPool.query<{id_intervalo_filtro:number}>("INSERT INTO intervalo_filtro(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm) VALUES($1,20,25,6,'Acero',NULL) RETURNING id_intervalo_filtro",[idPozo]);
  const lectura=await fetch(`${base}/usuarios/${propietario.id}/pozos/${idPozo}/intervalos_filtro`,{headers:headers(perforador.id,perforador.version)});
  assert.equal(lectura.status,200); const filtros=await lectura.json() as Array<{id_intervalo_filtro:number;desde_m:number;hasta_m:number;diametro_pulg:number;material_tuberia:"PVC"|"Acero";ranura_mm:number|null}>;
  assert.equal(filtros.find((f)=>f.id_intervalo_filtro===Number(historico.rows[0].id_intervalo_filtro))?.ranura_mm,null);

  const personalizado="Desarrollo personalizado RSP-06K";
  const edicion={pozo:{...cuerpo.pozo,id_sitio:idSitio,desarrollo:personalizado},intervalos_litologicos:[],intervalos_diametro:[],intervalos_filtro:filtros,niveles_aporte:[],foto_accion:"conservar"};
  const actualizado=await fetch(`${base}/usuarios/${perforador.id}/pozos/${idPozo}/completo`,{method:"PUT",headers:headers(perforador.id,perforador.version,true),body:JSON.stringify(edicion)});
  assert.equal(actualizado.status,200,await actualizado.clone().text()); const resultado=await actualizado.json() as {pozo:{desarrollo:string};intervalos_filtro:Array<{ranura_mm:number|null}>};
  assert.equal(resultado.pozo.desarrollo,personalizado); assert.ok(resultado.intervalos_filtro.some((f)=>f.ranura_mm===null));
  const db=await myPool.query<{desarrollo:string;ranuras:string}>("SELECT p.desarrollo,(SELECT string_agg(COALESCE(f.ranura_mm::text,'NULL'),',' ORDER BY f.desde_m) FROM intervalo_filtro f WHERE f.id_pozo=p.id_pozo) ranuras FROM pozo p WHERE p.id_pozo=$1",[idPozo]);
  assert.equal(db.rows[0].desarrollo,personalizado); assert.match(db.rows[0].ranuras,/0.75,NULL/);
  console.log(JSON.stringify({defaults_http:201,personalizado_http:200,ranura_075:true,ranura_faltante:400,ranura_060:400,historico_null:true,lectura:true,evidencia_temporal:false}));
} finally {
  if (idPozo) await myPool.query("DELETE FROM pozo WHERE id_pozo=$1",[idPozo]);
  if (idSitio) await myPool.query("DELETE FROM sitio WHERE id_sitio=$1",[idSitio]);
  await myPool.end();
}
