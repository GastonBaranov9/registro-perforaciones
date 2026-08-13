import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { myPool } from "../src/db/pool.ts";

const base = process.env.RSP06I_API_URL ?? "http://localhost:3000";
const secret = process.env.FASTIFY_SECRET;
assert.ok(secret);
const sufijo = randomUUID();
let pozoId = 0;
let sitioId = 0;

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function jwt(id: number, version: number) {
  const encabezado = b64({ alg: "HS256", typ: "JWT" });
  const carga = b64({ sub: id, version_sesion: version, roles: [] });
  const firmado = `${encabezado}.${carga}`;
  return `${firmado}.${createHmac("sha256", secret).update(firmado).digest("base64url")}`;
}
function headers(id: number, version: number) {
  const csrf = `rsp06i-r5-${id}`;
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

try {
  const perforador = await cuenta("perforador");
  const propietario = await cuenta("propietario");
  const catalogo = (await myPool.query<{ id_litologia: number; nombre: string }>(
    "SELECT id_litologia,nombre FROM catalogo_litologia WHERE activo=TRUE ORDER BY id_litologia LIMIT 1")).rows[0];
  assert.ok(catalogo);
  const cuerpo = {
    pozo: { id_propietario: propietario.id, id_perforador: perforador.id, empresa: `RSP06I-R5 ${sufijo}`, profundidad_final_m: 10 },
    sitio_nuevo: { departamento: `RSP06I-R5 ${sufijo}`, localidad: "Control", latitud: "-31", longitud: "-57" },
    intervalos_litologicos: [{ desde_m: 0, hasta_m: 10, material: catalogo.nombre, id_litologia: catalogo.id_litologia }],
    intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
  };
  const alta = await fetch(`${base}/usuarios/${propietario.id}/pozos/completo`, { method: "POST", headers: headers(perforador.id, perforador.version), body: JSON.stringify(cuerpo) });
  assert.equal(alta.status, 201, await alta.clone().text());
  const creado = await alta.json() as { pozo: { id_pozo: number; id_sitio: number } };
  pozoId = creado.pozo.id_pozo; sitioId = creado.pozo.id_sitio;

  const legacy = await fetch(`${base}/usuarios/${perforador.id}/pozos/${pozoId}`, {
    method: "PUT", headers: headers(perforador.id, perforador.version),
    body: JSON.stringify({ ...cuerpo.pozo, id_sitio: sitioId + 999999, empresa: `RSP06I-R5 editado ${sufijo}` }),
  });
  assert.equal(legacy.status, 200, await legacy.clone().text());
  const legacyResultado = await legacy.json() as { id_sitio: number; empresa: string };
  assert.equal(legacyResultado.id_sitio, sitioId);
  assert.equal(legacyResultado.empresa, `RSP06I-R5 editado ${sufijo}`);

  const antes = (await myPool.query<{ id_litologia: number }>("SELECT id_litologia FROM intervalo_litologico WHERE id_pozo=$1", [pozoId])).rows[0];
  assert.equal(Number(antes.id_litologia), Number(catalogo.id_litologia));
  const compatible = { ...cuerpo, pozo: { ...cuerpo.pozo, id_sitio: sitioId, empresa: `RSP06I-R5 completo ${sufijo}` }, intervalos_litologicos: [{ desde_m: 0, hasta_m: 10, material: catalogo.nombre }], foto_accion: "conservar" };
  const update = await fetch(`${base}/usuarios/${perforador.id}/pozos/${pozoId}/completo`, { method: "PUT", headers: headers(perforador.id, perforador.version), body: JSON.stringify(compatible) });
  assert.equal(update.status, 200, await update.clone().text());
  const despues = (await myPool.query<{ id_litologia: number }>("SELECT id_litologia FROM intervalo_litologico WHERE id_pozo=$1", [pozoId])).rows[0];
  assert.equal(Number(despues.id_litologia), Number(catalogo.id_litologia));
  console.log(JSON.stringify({ put_legacy: 200, sitio_inmutable: true, update_compatible: 200, id_litologia_preservado: true }));
} finally {
  if (pozoId) await myPool.query("DELETE FROM pozo WHERE id_pozo=$1", [pozoId]);
  if (sitioId) await myPool.query("DELETE FROM sitio WHERE id_sitio=$1", [sitioId]);
  await myPool.end();
}
