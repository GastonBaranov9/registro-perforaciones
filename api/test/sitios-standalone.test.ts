import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { myPool } from "../src/db/pool.ts";
import sitiosRoutes from "../src/routes/sitios.ts";
import jwt from '../src/plugins/jwt.ts';
import cookies, { SESSION_COOKIE } from '../src/plugins/cookies.ts';

const body = { departamento: "Salto", localidad: "Centro", latitud: "-31", longitud: "-57", padron: "001-AB" };

test('sitios: HTTP y transacción restringen operador, multirol y carrera de desvinculación', async t => {
  process.env.FASTIFY_SECRET = 'sitios-test-only-secret';
  let roles = ['operador_administrativo'], asociado = true, retirarAlIniciar = false;
  let escrituras = 0;
  const consultas: string[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    consultas.push(sql);
    if (sql.includes('SELECT activo, version_sesion')) return { rows: [{ activo: true, version_sesion: 1 }] };
    if (sql.includes('session-write-user-lock')) {
      if (retirarAlIniciar) asociado = false;
      return { rows: [{ activo: true, cuenta_acceso: true, version_sesion: 1 }] };
    }
    if (sql.includes('FROM rol r')) return { rows: roles.map(nombre => ({ id_rol: 4, nombre, descr: nombre })) };
    if (sql.includes('FROM usuario_rol')) return { rows: roles.map(r => r.toLowerCase()).includes(String(params[1])) ? [{}] : [] };
    if (sql.includes('SELECT id_pozo FROM public.pozo WHERE id_sitio')) return { rows: asociado ? [{ id_pozo: 22 }] : [] };
    if (sql.includes('FROM public.pozo p')) return { rows: [] };
    if (sql.includes('UPDATE sitio')) { escrituras++; return { rows: [{ id_sitio: 12, ...body }] }; }
    if (sql.includes('FROM sitio')) return { rows: [{ id_sitio: 12, ...body }] };
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    throw Error('SQL inesperado: ' + sql);
  };
  t.mock.method(myPool, 'query', query);
  t.mock.method(myPool, 'connect', async () => ({ query, release() {} }) as any);
  const app = Fastify(); t.after(() => app.close());
  await app.register(cookies); await app.register(jwt); await app.register(sitiosRoutes);
  const credentials = { [SESSION_COOKIE]: app.jwt.sign({ sub: 7, version_sesion: 1 }, { expiresIn: '1h' }) };
  const call = (method: 'GET'|'PUT'|'POST'|'DELETE', url = '/usuarios/999/sitios/12') => app.inject({
    method, url, cookies: credentials, ...(['PUT','POST'].includes(method) ? { payload: body } : {}),
  });
  for (const conjunto of [['operador_administrativo'], ['OPERADOR_ADMINISTRATIVO', 'perforador', 'propietario']]) {
    roles = conjunto; asociado = true;
    for (const method of ['GET','PUT'] as const) {
      const r = await call(method); assert.equal(r.statusCode, 200, r.body);
    }
    asociado = false;
    const antes = escrituras;
    for (const method of ['GET','PUT','DELETE'] as const) {
      const r = await call(method); assert.equal(r.statusCode, 403, r.body);
    }
    for (const method of ['GET','POST'] as const) {
      const r = await call(method, '/usuarios/999/sitios'); assert.equal(r.statusCode, 403, r.body);
    }
    assert.equal(escrituras, antes, 'sin escrituras sobre sitios independientes');
    for (const url of ['/usuarios/999/sitios/12/mapa-aereo', '/usuarios/999/sitios/12/mapa-aereo/preview?latitud=-31&longitud=-57'])
      assert.equal((await call('GET', url)).statusCode, 403, 'mapas también respetan la asociación');
  }
  roles = ['administracion'];
  for (const method of ['GET','PUT'] as const) {
    const r = await call(method); assert.equal(r.statusCode, 200, r.body);
  }
  roles = ['operador_administrativo']; asociado = true; retirarAlIniciar = true;
  consultas.length = 0;
  const antes = escrituras, carrera = await call('PUT');
  assert.equal(carrera.statusCode, 403, carrera.body);
  assert.equal(escrituras, antes);
  assert.equal(consultas.filter(q => q.includes('SELECT id_pozo FROM public.pozo WHERE id_sitio')).length, 2);
  assert.ok(consultas.some(q => q.includes('LIMIT 1 FOR SHARE')));
  assert.ok(consultas.includes('ROLLBACK')); assert.ok(!consultas.includes('COMMIT'));
});

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
      if (sql.includes('FROM usuario_rol')) return { rows: [] };
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
  app.decorate("puedeOperarPozos", async () => {});
  app.decorate("puedeConsultarRecursos", async () => {});
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
