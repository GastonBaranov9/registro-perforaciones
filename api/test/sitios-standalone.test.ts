import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { myPool } from "../src/db/pool.ts";
import sitiosRoutes from "../src/routes/sitios.ts";

const body = { departamento: "Salto", localidad: "Centro", latitud: "-31", longitud: "-57" };

async function appConUsuario(idUsuario: number) {
  const app = Fastify();
  app.decorate("authenticate", async (req) => { (req as unknown as { user: { sub: number } }).user = { sub: idUsuario }; });
  app.decorate("userIsAdminOrPerforador", async () => {});
  app.decorate("userIsPropietarioOrPerforadorOrAdmin", async () => {});
  await app.register(sitiosRoutes);
  return app;
}

test("un perforador no puede crear sitios standalone y no se inserta nada", async () => {
  const consultas: string[] = [];
  const pool = myPool as typeof myPool & { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }> };
  const original = pool.query;
  pool.query = async (sql) => { consultas.push(sql); return { rows: [] }; };
  const app = await appConUsuario(8);
  try {
    const respuesta = await app.inject({ method: "POST", url: "/usuarios/8/sitios", payload: body });
    assert.equal(respuesta.statusCode, 403);
    assert.equal(consultas.some((sql) => sql.includes("INSERT INTO sitio")), false);
  } finally {
    pool.query = original;
    await app.close();
  }
});

test("administración conserva la creación standalone", async () => {
  const consultas: string[] = [];
  const pool = myPool as typeof myPool & { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }> };
  const original = pool.query;
  pool.query = async (sql) => {
    consultas.push(sql);
    if (sql.includes("FROM rol r")) return { rows: [{ id_rol: 1, nombre: "administracion", descr: "Administración" }] };
    if (sql.includes("INSERT INTO sitio")) return { rows: [{ id_sitio: 12, ...body }] };
    return { rows: [] };
  };
  const app = await appConUsuario(2);
  try {
    const respuesta = await app.inject({ method: "POST", url: "/usuarios/2/sitios", payload: body });
    assert.equal(respuesta.statusCode, 201, respuesta.body);
    assert.equal((respuesta.json() as { id_sitio: number }).id_sitio, 12);
    assert.equal(consultas.some((sql) => sql.includes("INSERT INTO sitio")), true);
  } finally {
    pool.query = original;
    await app.close();
  }
});
