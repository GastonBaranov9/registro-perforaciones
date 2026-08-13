import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { myPool } from "../src/db/pool.ts";

const base = process.env.RSP06I_API_URL ?? "http://localhost:3000";
const secret = process.env.FASTIFY_SECRET;
assert.ok(secret);
const sufijo = randomUUID();
let pozoId = 0;
let sitioId = 0;
let pozoIntervalosId = 0;
let sitioIntervalosId = 0;

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function jwt(id: number, version: number) {
  const encabezado = b64({ alg: "HS256", typ: "JWT" });
  const carga = b64({ sub: id, version_sesion: version, roles: [] });
  const firmado = `${encabezado}.${carga}`;
  return `${firmado}.${createHmac("sha256", secret).update(firmado).digest("base64url")}`;
}
function headers(id: number, version: number) {
  const csrf = `rsp06i-r4-${id}`;
  return { cookie: `rsp_session=${jwt(id, version)}; rsp_csrf=${csrf}`, "x-csrf-token": csrf, "content-type": "application/json" };
}
async function cuenta(rol: string) {
  const { rows } = await myPool.query<{ id_usuario: number; version_sesion: number }>(
    `SELECT u.id_usuario,u.version_sesion FROM usuario u
     JOIN usuario_rol ur ON ur.id_usuario=u.id_usuario JOIN rol r ON r.id_rol=ur.id_rol
     WHERE u.cuenta_acceso=TRUE AND r.nombre=$1 LIMIT 1`, [rol]);
  assert.ok(rows[0]);
  return { id: Number(rows[0].id_usuario), version: Number(rows[0].version_sesion) };
}
function pozoBody(perforador: number, propietario: number, departamento: string, latitud: string, longitud: string, conLitologia = false) {
  return {
    pozo: { id_propietario: propietario, id_perforador: perforador, profundidad_final_m: 20 },
    sitio_nuevo: { departamento, localidad: "Control", latitud, longitud },
    intervalos_litologicos: conLitologia ? [{ desde_m: 0, hasta_m: 10, material: "Arena" }, { desde_m: 10, hasta_m: 20, material: "Roca" }] : [],
    intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
  };
}

try {
  const perforador = await cuenta("perforador");
  const propietario = await cuenta("propietario");
  const invalido = pozoBody(perforador.id, propietario.id, `RSP06I-R4 whitespace ${sufijo}`, "   ", "0");
  const rechazado = await fetch(`${base}/usuarios/${perforador.id}/pozos/completo`, { method: "POST", headers: headers(perforador.id, perforador.version), body: JSON.stringify(invalido) });
  assert.equal(rechazado.status, 400);
  assert.equal(Number((await myPool.query("SELECT count(*)::int AS cantidad FROM sitio WHERE departamento=$1", [invalido.sitio_nuevo.departamento])).rows[0].cantidad), 0);

  const valido = pozoBody(perforador.id, propietario.id, `RSP06I-R4 zero ${sufijo}`, " 0 ", " 0.0 ");
  const creado = await fetch(`${base}/usuarios/${perforador.id}/pozos/completo`, { method: "POST", headers: headers(perforador.id, perforador.version), body: JSON.stringify(valido) });
  assert.equal(creado.status, 201, await creado.clone().text());
  const resultado = await creado.json() as { pozo: { id_pozo: number; id_sitio: number } };
  pozoId = resultado.pozo.id_pozo; sitioId = resultado.pozo.id_sitio;
  const persistido = (await myPool.query("SELECT latitud,longitud FROM sitio WHERE id_sitio=$1", [sitioId])).rows[0];
  assert.deepEqual(persistido, { latitud: "0", longitud: "0.0" });

  const conLitologia = pozoBody(perforador.id, propietario.id, `RSP06I-R4 duplicado ${sufijo}`, "-31", "-57", true);
  const pozoConIntervalos = await fetch(`${base}/usuarios/${perforador.id}/pozos/completo`, { method: "POST", headers: headers(perforador.id, perforador.version), body: JSON.stringify(conLitologia) });
  assert.equal(pozoConIntervalos.status, 201, await pozoConIntervalos.clone().text());
  const creadoConIntervalos = await pozoConIntervalos.json() as { pozo: { id_pozo: number; id_sitio: number }; intervalos_litologicos: Array<{ id_intervalo_litologico: number }> };
  pozoIntervalosId = creadoConIntervalos.pozo.id_pozo;
  sitioIntervalosId = creadoConIntervalos.pozo.id_sitio;
  const { sitio_nuevo: _sitioNuevo, ...sinSitioNuevo } = conLitologia;
  const duplicado = { ...sinSitioNuevo, pozo: { ...conLitologia.pozo, id_sitio: creadoConIntervalos.pozo.id_sitio }, intervalos_litologicos: [{ ...conLitologia.intervalos_litologicos[0], id_intervalo_litologico: creadoConIntervalos.intervalos_litologicos[0].id_intervalo_litologico }, { ...conLitologia.intervalos_litologicos[1], id_intervalo_litologico: creadoConIntervalos.intervalos_litologicos[0].id_intervalo_litologico }], foto_accion: "conservar" };
  const update = await fetch(`${base}/usuarios/${perforador.id}/pozos/${creadoConIntervalos.pozo.id_pozo}/completo`, { method: "PUT", headers: headers(perforador.id, perforador.version), body: JSON.stringify(duplicado) });
  assert.equal(update.status, 400, await update.clone().text());
  const cantidadIntervalos = Number((await myPool.query("SELECT count(*)::int AS cantidad FROM intervalo_litologico WHERE id_pozo=$1", [creadoConIntervalos.pozo.id_pozo])).rows[0].cantidad);
  assert.equal(cantidadIntervalos, 2);
  await myPool.query("DELETE FROM pozo WHERE id_pozo=$1", [pozoIntervalosId]);
  await myPool.query("DELETE FROM sitio WHERE id_sitio=$1", [sitioIntervalosId]);
  console.log(JSON.stringify({ whitespace: 400, cero_explicito: 201, coordenadas_persistidas: true, id_litologico_duplicado: 400, rollback_actualizacion: true }));
} finally {
  if (pozoId) await myPool.query("DELETE FROM pozo WHERE id_pozo=$1", [pozoId]);
  if (sitioId) await myPool.query("DELETE FROM sitio WHERE id_sitio=$1", [sitioId]);
  if (pozoIntervalosId) await myPool.query("DELETE FROM pozo WHERE id_pozo=$1", [pozoIntervalosId]);
  if (sitioIntervalosId) await myPool.query("DELETE FROM sitio WHERE id_sitio=$1", [sitioIntervalosId]);
  await myPool.end();
}
