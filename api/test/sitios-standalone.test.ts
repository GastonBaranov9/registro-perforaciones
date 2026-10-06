import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { myPool } from "../src/db/pool.ts";
import sitiosRoutes from "../src/routes/sitios.ts";

const body = { departamento: "Salto", localidad: "Centro", latitud: "-31", longitud: "-57", padron: "001-AB" };

for (const rol of ['propietario', 'perforador', 'administracion']) {
  test(`${rol}: listado standalone exclusivo de administración, sin consultar sitios si se deniega`, async t => {
    const consultas: string[] = [];
    t.mock.method(myPool, 'query', async (sql: string) => {
      consultas.push(sql);
      if (sql.includes('FROM rol r')) return { rows: [{ id_rol: 1, nombre: rol, descr: rol }] };
      if (sql.includes('FROM sitio')) return { rows: [{ id_sitio: 12, ...body }] };
      throw new Error('Consulta inesperada: ' + sql);
    });
    const app = await appConUsuario(8);
    try {
      const respuesta = await app.inject({ method: 'GET', url: '/usuarios/999/sitios' });
      assert.equal(respuesta.statusCode, rol === 'administracion' ? 200 : 403, respuesta.body);
      assert.equal(consultas.some(sql => sql.includes('FROM sitio')), rol === 'administracion');
      if (rol === 'administracion') assert.equal(respuesta.json().length, 1);
    } finally { await app.close(); }
  });
}

for (const caso of ['propio reciente', 'vencido', 'ajeno', 'compartido', 'sin pozo']) {
  test(`edición interna de coordenadas por perforador: ${caso}`, async t => {
    let escrituras = 0;
    t.mock.method(myPool, 'query', async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM rol r')) return { rows: [{ id_rol: 2, nombre: 'perforador' }] };
      if (sql.includes('SELECT creado_por, fecha_creado')) {
        assert.deepEqual(params, [12]);
        const propio = { creado_por: 8, fecha_creado: new Date(Date.now() - 1000) };
        return { rows: caso === 'sin pozo' ? [] : caso === 'compartido' ? [propio, { ...propio, creado_por: 9 }]
          : [{ ...propio, creado_por: caso === 'ajeno' ? 9 : 8, fecha_creado: caso === 'vencido' ? new Date(0) : propio.fecha_creado }] };
      }
      if (sql.includes('SELECT 1 FROM sitio')) return { rows: [{}] };
      if (sql.includes('UPDATE sitio')) { escrituras++; return { rows: [{ id_sitio: 12, ...body }] }; }
      throw new Error('Consulta inesperada: ' + sql);
    });
    const app = await appConUsuario(8);
    try {
      const respuesta = await app.inject({ method: 'PUT', url: '/usuarios/999/sitios/12', payload: body });
      assert.equal(respuesta.statusCode, caso === 'propio reciente' ? 200 : 403, respuesta.body);
      assert.equal(escrituras, caso === 'propio reciente' ? 1 : 0);
    } finally { await app.close(); }
  });
}

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
