import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { myPool } from "../src/db/pool.ts";

const base = process.env.RSP06I_API_URL ?? "http://localhost:3000";
const secret = process.env.FASTIFY_SECRET;
assert.ok(secret);
const sufijo = randomUUID();
let pozoId = 0;
let sitioId = 0;

type Litologia = { id_litologia: number; nombre: string };
type Intervalo = { id_intervalo_litologico: number; desde_m: number; hasta_m: number; material: string; id_litologia: number };

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function jwt(id: number, version: number) {
  const encabezado = b64({ alg: "HS256", typ: "JWT" });
  const carga = b64({ sub: id, version_sesion: version, roles: [] });
  const firmado = `${encabezado}.${carga}`;
  return `${firmado}.${createHmac("sha256", secret).update(firmado).digest("base64url")}`;
}
function headers(id: number, version: number) {
  const csrf = `rsp06i-r6-${id}`;
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
function perfil(intervalos: Intervalo[]) {
  return intervalos.map((intervalo) => ({
    id_intervalo_litologico: Number(intervalo.id_intervalo_litologico), desde_m: Number(intervalo.desde_m),
    hasta_m: Number(intervalo.hasta_m), material: String(intervalo.material), id_litologia: Number(intervalo.id_litologia),
  })).sort((a, b) => a.desde_m - b.desde_m);
}

try {
  const perforador = await cuenta("perforador");
  const propietario = await cuenta("propietario");
  const catalogo = (await myPool.query<Litologia>(
    "SELECT id_litologia,nombre FROM catalogo_litologia WHERE activo=TRUE ORDER BY id_litologia LIMIT 4")).rows
    .map((fila) => ({ id_litologia: Number(fila.id_litologia), nombre: String(fila.nombre) }));
  assert.equal(catalogo.length, 4, "La evidencia R6 requiere cuatro litologías activas");
  const [a, b, c, d] = catalogo;
  const cuerpo = {
    pozo: { id_propietario: propietario.id, id_perforador: perforador.id, empresa: `RSP06I-R6 ${sufijo}`, profundidad_final_m: 100 },
    sitio_nuevo: { departamento: `RSP06I-R6 ${sufijo}`, localidad: "Control", latitud: "-31", longitud: "-57" },
    intervalos_litologicos: [
      { desde_m: 0, hasta_m: 10, material: a.nombre, id_litologia: a.id_litologia },
      { desde_m: 10, hasta_m: 40, material: b.nombre, id_litologia: b.id_litologia },
      { desde_m: 40, hasta_m: 100, material: c.nombre, id_litologia: c.id_litologia },
    ], intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
  };
  const alta = await fetch(`${base}/usuarios/${propietario.id}/pozos/completo`, {
    method: "POST", headers: headers(perforador.id, perforador.version), body: JSON.stringify(cuerpo),
  });
  assert.equal(alta.status, 201, await alta.clone().text());
  const creado = await alta.json() as { pozo: { id_pozo: number; id_sitio: number }; intervalos_litologicos: Intervalo[] };
  pozoId = Number(creado.pozo.id_pozo); sitioId = Number(creado.pozo.id_sitio);
  const iniciales = perfil(creado.intervalos_litologicos);
  const idsIniciales = new Set(iniciales.map((intervalo) => intervalo.id_intervalo_litologico));

  const pozoActualizado = { ...cuerpo.pozo, id_sitio: sitioId, empresa: `RSP06I-R6 editado ${sufijo}` };
  const solapado = {
    pozo: pozoActualizado, foto_accion: "conservar", intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
    intervalos_litologicos: [
      { ...iniciales[0], desde_m: 0, hasta_m: 10 },
      { ...iniciales[1], desde_m: 5, hasta_m: 40 },
      { ...iniciales[2], desde_m: 40, hasta_m: 100 },
    ],
  };
  const rechazo = await fetch(`${base}/usuarios/${perforador.id}/pozos/${pozoId}/completo`, {
    method: "PUT", headers: headers(perforador.id, perforador.version), body: JSON.stringify(solapado),
  });
  assert.equal(rechazo.status, 400, await rechazo.clone().text());
  assert.equal(Number((await myPool.query("SELECT count(*)::int AS cantidad FROM intervalo_litologico WHERE id_pozo=$1", [pozoId])).rows[0].cantidad), 3);

  const valido = {
    pozo: pozoActualizado, foto_accion: "conservar", intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
    intervalos_litologicos: [
      { ...iniciales[0], desde_m: 0, hasta_m: 5 },
      { desde_m: 5, hasta_m: 10, material: d.nombre, id_litologia: d.id_litologia },
      { ...iniciales[1], desde_m: 10, hasta_m: 40 },
      { ...iniciales[2], desde_m: 40, hasta_m: 100 },
    ],
  };
  const update = await fetch(`${base}/usuarios/${perforador.id}/pozos/${pozoId}/completo`, {
    method: "PUT", headers: headers(perforador.id, perforador.version), body: JSON.stringify(valido),
  });
  assert.equal(update.status, 200, await update.clone().text());
  const actualizado = await update.json() as { intervalos_litologicos: Intervalo[] };
  const esperado = perfil(actualizado.intervalos_litologicos);
  assert.deepEqual(esperado.map((i) => [i.desde_m, i.hasta_m]), [[0, 5], [5, 10], [10, 40], [40, 100]]);
  assert.deepEqual(esperado.map((i) => i.id_litologia), [a.id_litologia, d.id_litologia, b.id_litologia, c.id_litologia]);
  assert.equal(new Set(esperado.map((i) => i.id_intervalo_litologico)).size, 4);
  assert.equal(idsIniciales.has(esperado[1].id_intervalo_litologico), false, "El tramo nuevo no debe reutilizar un ID persistido");

  const reapertura = await fetch(`${base}/usuarios/${perforador.id}/pozos/${pozoId}/intervalo_litologico`, {
    headers: headers(perforador.id, perforador.version),
  });
  assert.equal(reapertura.status, 200, await reapertura.clone().text());
  const reabierto = perfil(await reapertura.json() as Intervalo[]);
  assert.deepEqual(reabierto, esperado);
  const postgres = perfil((await myPool.query<Intervalo>(
    "SELECT id_intervalo_litologico,desde_m,hasta_m,material,id_litologia FROM intervalo_litologico WHERE id_pozo=$1 ORDER BY desde_m", [pozoId])).rows);
  assert.deepEqual(postgres, esperado);
  console.log(JSON.stringify({ alta: 201, solapamiento: 400, update: 200, intervalos: 4, ids_unicos: true, id_nuevo: esperado[1].id_intervalo_litologico, reapertura: true, postgres: true }));
} finally {
  if (pozoId) await myPool.query("DELETE FROM pozo WHERE id_pozo=$1", [pozoId]);
  if (sitioId) await myPool.query("DELETE FROM sitio WHERE id_sitio=$1", [sitioId]);
  await myPool.end();
}
