import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { myPool } from "../src/db/pool.ts";

const base = process.env.RSP06I_API_URL ?? "http://localhost:3000";
const secret = process.env.FASTIFY_SECRET;
assert.ok(secret, "Falta FASTIFY_SECRET");
const nombre = `Identidad RSP-06I-R2 ${randomUUID()}`;
let idOperativo = 0;

function segmento(data: unknown): string {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function token(sub: number, version: number): string {
  const encabezado = segmento({ alg: "HS256", typ: "JWT" });
  const carga = segmento({ sub, version_sesion: version, roles: [] });
  const firmado = `${encabezado}.${carga}`;
  const firma = createHmac("sha256", secret).update(firmado).digest("base64url");
  return `${firmado}.${firma}`;
}

try {
  const propietario = (await myPool.query<{ id_rol: number }>(
    "SELECT id_rol FROM rol WHERE nombre = 'propietario'",
  )).rows[0];
  assert.ok(propietario);
  const creado = await myPool.query<{ id_usuario: number }>(
    `INSERT INTO usuario (email, nombre, password, activo, cuenta_acceso)
     VALUES (NULL, $1, NULL, TRUE, FALSE) RETURNING id_usuario`,
    [nombre],
  );
  idOperativo = Number(creado.rows[0].id_usuario);
  await myPool.query("INSERT INTO usuario_rol (id_usuario, id_rol) VALUES ($1, $2)", [idOperativo, propietario.id_rol]);

  const admin = (await myPool.query<{ id_usuario: number; version_sesion: number }>(
    `SELECT u.id_usuario, u.version_sesion
     FROM usuario u JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
     JOIN rol r ON r.id_rol = ur.id_rol
     WHERE u.cuenta_acceso = TRUE AND r.nombre = 'administracion'
     LIMIT 1`,
  )).rows[0];
  assert.ok(admin, "Falta una cuenta administrativa local");
  const jwt = token(Number(admin.id_usuario), Number(admin.version_sesion));
  const headers = { cookie: `rsp_session=${jwt}; rsp_csrf=rsp06i-r2`, "x-csrf-token": "rsp06i-r2" };

  const usuarios = await fetch(`${base}/usuarios`, { headers });
  assert.equal(usuarios.status, 200);
  const lista = await usuarios.json() as Array<{ id_usuario: number; email: string | null }>;
  assert.equal(lista.some((u) => u.id_usuario === idOperativo), false);
  assert.equal(lista.every((u) => u.email !== null), true);

  const detalle = await fetch(`${base}/usuarios/${idOperativo}`, { headers });
  assert.equal(detalle.status, 404);
  const roles = await fetch(`${base}/usuarios/${idOperativo}/roles/1`, { method: "PUT", headers });
  assert.equal(roles.status, 404);

  const candidatos = await fetch(`${base}/pozos/candidatos-personas?propietario=${encodeURIComponent(nombre)}`, { headers });
  assert.equal(candidatos.status, 200);
  const cuerpo = await candidatos.json() as { propietarios: Array<{ id_usuario: number }> };
  assert.equal(cuerpo.propietarios.some((c) => c.id_usuario === idOperativo), true);
  console.log(JSON.stringify({ usuarios: 200, identidad_fuera_de_cuentas: true, detalle: 404, roles: 404, candidato: true }));
} finally {
  if (idOperativo) await myPool.query("DELETE FROM usuario WHERE id_usuario = $1", [idOperativo]);
  await myPool.end();
}
