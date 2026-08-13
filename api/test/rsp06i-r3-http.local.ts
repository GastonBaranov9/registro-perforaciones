import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { myPool } from "../src/db/pool.ts";

const base = process.env.RSP06I_API_URL ?? "http://localhost:3000";
const secret = process.env.FASTIFY_SECRET;
assert.ok(secret);
const sufijo = randomUUID();
let standaloneId = 0;
let pozoId = 0;
let pozoSitioId = 0;

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function jwt(id: number, version: number) {
  const encabezado = b64({ alg: "HS256", typ: "JWT" });
  const carga = b64({ sub: id, version_sesion: version, roles: [] });
  const firmado = `${encabezado}.${carga}`;
  return `${firmado}.${createHmac("sha256", secret).update(firmado).digest("base64url")}`;
}
function headers(id: number, version: number) {
  const csrf = `rsp06i-r3-${id}`;
  return { cookie: `rsp_session=${jwt(id, version)}; rsp_csrf=${csrf}`, "x-csrf-token": csrf, "content-type": "application/json" };
}
async function cuenta(rol: string) {
  const { rows } = await myPool.query<{ id_usuario: number; version_sesion: number }>(
    `SELECT u.id_usuario,u.version_sesion FROM usuario u
     JOIN usuario_rol ur ON ur.id_usuario=u.id_usuario JOIN rol r ON r.id_rol=ur.id_rol
     WHERE u.cuenta_acceso=TRUE AND r.nombre=$1 LIMIT 1`, [rol]);
  assert.ok(rows[0], `Falta cuenta con rol ${rol}`);
  return { id: Number(rows[0].id_usuario), version: Number(rows[0].version_sesion) };
}

try {
  const admin = await cuenta("administracion");
  const perforador = await cuenta("perforador");
  const propietario = await cuenta("propietario");
  const sitioBody = { departamento: `RSP06I-R3 ${sufijo}`, localidad: "Control", latitud: "-31", longitud: "-57" };

  const antes = Number((await myPool.query("SELECT count(*)::int AS cantidad FROM sitio WHERE departamento=$1", [sitioBody.departamento])).rows[0].cantidad);
  const prohibido = await fetch(`${base}/usuarios/${perforador.id}/sitios`, { method: "POST", headers: headers(perforador.id, perforador.version), body: JSON.stringify(sitioBody) });
  assert.equal(prohibido.status, 403);
  const despues = Number((await myPool.query("SELECT count(*)::int AS cantidad FROM sitio WHERE departamento=$1", [sitioBody.departamento])).rows[0].cantidad);
  assert.equal(despues, antes);

  const creadoAdmin = await fetch(`${base}/usuarios/${admin.id}/sitios`, { method: "POST", headers: headers(admin.id, admin.version), body: JSON.stringify(sitioBody) });
  const creadoAdminTexto = await creadoAdmin.text();
  assert.equal(creadoAdmin.status, 201, creadoAdminTexto);
  standaloneId = Number((JSON.parse(creadoAdminTexto) as { id_sitio: number }).id_sitio);

  const pozoBody = {
    pozo: { id_propietario: propietario.id, id_perforador: perforador.id, profundidad_final_m: 10 },
    sitio_nuevo: { departamento: `RSP06I-R3 Pozo ${sufijo}`, localidad: "Control", latitud: "-31.1", longitud: "-57.1" },
    intervalos_litologicos: [], intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
  };
  const creadoPozo = await fetch(`${base}/usuarios/${perforador.id}/pozos/completo`, { method: "POST", headers: headers(perforador.id, perforador.version), body: JSON.stringify(pozoBody) });
  const creadoPozoTexto = await creadoPozo.text();
  assert.equal(creadoPozo.status, 201, creadoPozoTexto);
  const resultado = JSON.parse(creadoPozoTexto) as { pozo: { id_pozo: number; id_sitio: number } };
  pozoId = resultado.pozo.id_pozo;
  pozoSitioId = resultado.pozo.id_sitio;
  assert.ok(pozoSitioId > 0);
  const sitioVinculado = await fetch(`${base}/usuarios/${perforador.id}/sitios/${pozoSitioId}`, { headers: headers(perforador.id, perforador.version) });
  assert.equal(sitioVinculado.status, 200);
  const editado = await fetch(`${base}/usuarios/${perforador.id}/sitios/${pozoSitioId}`, { method: "PUT", headers: headers(perforador.id, perforador.version), body: JSON.stringify({ ...pozoBody.sitio_nuevo, localidad: "Editado" }) });
  assert.equal(editado.status, 200, await editado.text());
  console.log(JSON.stringify({ standalone_perforador: 403, sin_huerfano: true, standalone_admin: 201, pozo_sitio_atomico: 201, sitio_vinculado: 200, sitio_editado: 200 }));
} finally {
  if (pozoId) await myPool.query("DELETE FROM pozo WHERE id_pozo=$1", [pozoId]);
  if (pozoSitioId) await myPool.query("DELETE FROM sitio WHERE id_sitio=$1", [pozoSitioId]);
  if (standaloneId) await myPool.query("DELETE FROM sitio WHERE id_sitio=$1", [standaloneId]);
  await myPool.end();
}
