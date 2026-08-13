import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { myPool } from "../src/db/pool.ts";
import { crearPDFConDiagnostico } from "../src/pdf/pdf-generate.ts";
import { getReportePozo } from "../src/services/generar-informe-consultas.ts";

const base = process.env.RSP06K_R1_API_URL ?? "http://localhost:3000";
const secret = process.env.FASTIFY_SECRET;
assert.ok(secret);
let idPozo = 0;
let idSitio = 0;

const b64 = (valor: unknown) => Buffer.from(JSON.stringify(valor)).toString("base64url");
function jwt(id: number, version: number) {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ sub: id, version_sesion: version, roles: [] });
  const firma = `${h}.${p}`;
  return `${firma}.${createHmac("sha256", secret!).update(firma).digest("base64url")}`;
}
function headers(id: number, version: number, mutacion = false) {
  const csrf = `rsp06k-r1-${id}`;
  return {
    cookie: `rsp_session=${jwt(id, version)}; rsp_csrf=${csrf}`,
    ...(mutacion ? { "x-csrf-token": csrf, "content-type": "application/json" } : {}),
  };
}
async function cuenta(rol: string) {
  const { rows } = await myPool.query<{ id_usuario:number; version_sesion:number }>(
    `SELECT u.id_usuario,u.version_sesion FROM usuario u JOIN usuario_rol ur ON ur.id_usuario=u.id_usuario JOIN rol r ON r.id_rol=ur.id_rol WHERE u.cuenta_acceso=TRUE AND u.activo=TRUE AND r.nombre=$1 LIMIT 1`,
    [rol],
  );
  assert.ok(rows[0]);
  return { id:Number(rows[0].id_usuario), version:Number(rows[0].version_sesion) };
}

try {
  const perforador = await cuenta("perforador");
  const propietario = await cuenta("propietario");
  const marca = randomUUID();
  const cuerpo = {
    pozo: {
      id_propietario: propietario.id,
      id_perforador: perforador.id,
      empresa: `RSP06K-R1 ${marca}`,
      profundidad_final_m: 30,
    },
    sitio_nuevo: {
      departamento: `RSP06K-R1 ${marca}`,
      localidad: "Temporal",
      latitud: "-31.4439167",
      longitud: "-57.9865556",
    },
    intervalos_litologicos: [{ desde_m:0, hasta_m:10, material:"Sello sanitario" }],
    intervalos_diametro: [],
    intervalos_filtro: [],
    niveles_aporte: [],
  };

  assert.ok(!("sello_sanitario" in cuerpo.pozo));
  assert.ok(!("pre_filtro" in cuerpo.pozo));
  const alta = await fetch(`${base}/usuarios/${propietario.id}/pozos/completo`, {
    method: "POST",
    headers: headers(perforador.id, perforador.version, true),
    body: JSON.stringify(cuerpo),
  });
  assert.equal(alta.status, 201, await alta.clone().text());
  const creado = await alta.json() as {
    pozo: { id_pozo:number; sello_sanitario:null; pre_filtro:null };
    sitio: { id_sitio:number };
    intervalos_litologicos: Array<Record<string, unknown>>;
  };
  idPozo = Number(creado.pozo.id_pozo);
  idSitio = Number(creado.sitio.id_sitio);
  assert.equal(creado.pozo.sello_sanitario, null);
  assert.equal(creado.pozo.pre_filtro, null);

  await myPool.query(
    "UPDATE pozo SET sello_sanitario=TRUE,pre_filtro=$2 WHERE id_pozo=$1",
    [idPozo, "Prefiltro histórico RSP-06K-R1"],
  );
  const edicion = {
    pozo: { ...cuerpo.pozo, id_sitio:idSitio, profundidad_final_m:35 },
    intervalos_litologicos: creado.intervalos_litologicos,
    intervalos_diametro: [],
    intervalos_filtro: [],
    niveles_aporte: [],
    foto_accion: "conservar",
  };
  const actualizado = await fetch(`${base}/usuarios/${perforador.id}/pozos/${idPozo}/completo`, {
    method: "PUT",
    headers: headers(perforador.id, perforador.version, true),
    body: JSON.stringify(edicion),
  });
  assert.equal(actualizado.status, 200, await actualizado.clone().text());

  const { rows:[historico] } = await myPool.query<{ sello_sanitario:boolean; pre_filtro:string; profundidad_final_m:string }>(
    "SELECT sello_sanitario,pre_filtro,profundidad_final_m FROM pozo WHERE id_pozo=$1",
    [idPozo],
  );
  assert.equal(historico.sello_sanitario, true);
  assert.equal(historico.pre_filtro, "Prefiltro histórico RSP-06K-R1");
  assert.equal(Number(historico.profundidad_final_m), 35);

  const reporte = await getReportePozo(idPozo);
  assert.ok(reporte);
  assert.ok(!Object.hasOwn(reporte, "sello_sanitario"));
  assert.ok(!Object.hasOwn(reporte, "pre_filtro"));
  assert.equal(reporte.litologia[0]?.material, "Sello sanitario");
  const { documento, diagnostico } = await crearPDFConDiagnostico(reporte, idPozo, { mapa:{} });
  assert.ok(!diagnostico.datosGenerales?.includes("Sello sanitario"));
  assert.ok(!diagnostico.datosGenerales?.includes("Prefiltro"));
  assert.equal(diagnostico.tablas[0].alturasFilas.length, 1);
  assert.ok(diagnostico.tablas.every((tabla) => (tabla.fuente ?? 9) >= 9 && tabla.bordeInferiorFinal >= 52));
  const bytes = await documento.save();
  const verificado = await PDFDocument.load(bytes);
  assert.ok(bytes.byteLength > 1_000);
  assert.ok(verificado.getPageCount() >= 4);

  console.log(JSON.stringify({
    alta_sin_campos:201,
    edicion_historica:200,
    historico_preservado:true,
    intervalo_sello:true,
    pdf:true,
    datos_generales_sin_duplicados:true,
    evidencia_temporal:false,
  }));
} finally {
  if (idPozo) await myPool.query("DELETE FROM pozo WHERE id_pozo=$1", [idPozo]);
  if (idSitio) await myPool.query("DELETE FROM sitio WHERE id_sitio=$1", [idSitio]);
  const { rows:[restos] } = await myPool.query<{ pozos:number; sitios:number }>(
    `SELECT
      (SELECT count(*)::int FROM pozo WHERE empresa LIKE 'RSP06K-R1 %') AS pozos,
      (SELECT count(*)::int FROM sitio WHERE departamento LIKE 'RSP06K-R1 %') AS sitios`,
  );
  assert.deepEqual(restos, { pozos:0, sitios:0 });
  await myPool.end();
}
