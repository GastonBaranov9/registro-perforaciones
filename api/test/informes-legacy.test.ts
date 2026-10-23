import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import cookies, { SESSION_COOKIE } from '../src/plugins/cookies.ts';
import jwt from '../src/plugins/jwt.ts';
import informes from '../src/routes/informes.ts';
import { myPool } from '../src/db/pool.ts';

const base = '/usuarios/7/pozos/90042';
const activas = [
  { method: 'GET', suffix: '/litologia' },
  { method: 'GET', suffix: '/perfil-litologico' },
  { method: 'POST', suffix: '/perfil-litologico/vista-previa' },
  { method: 'GET', suffix: '/informe-pdf' },
] as const;
const borrador = {
  profundidad_final_m: 20, intervalos_litologicos: [],
  intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
};

async function fixture(t: TestContext) {
  const secretAnterior = process.env.FASTIFY_SECRET;
  process.env.FASTIFY_SECRET = 'fixture-informes-legacy-secret-never-production';
  t.after(() => {
    if (secretAnterior === undefined) delete process.env.FASTIFY_SECRET;
    else process.env.FASTIFY_SECRET = secretAnterior;
  });
  const estado = { activo: true, version: 1, roles: ['administracion'], propio: true, consultas: 0, handlers: 0 };
  t.mock.method(myPool, 'connect', () => { throw new Error('La prueba no puede conectar a PostgreSQL'); });
  t.mock.method(myPool, 'query', async (sql: string, params: unknown[]) => {
    estado.consultas++;
    if (sql.includes('SELECT activo, version_sesion')) {
      assert.deepEqual(params, [7]);
      return { rows: [{ activo: estado.activo, version_sesion: estado.version }] };
    }
    if (sql.includes('SELECT r.nombre FROM rol r')) return { rows: estado.roles.map(nombre => ({ nombre })) };
    if (sql.includes('FROM usuario_rol')) {
      assert.equal(params[0], 7);
      return { rows: estado.roles.includes(String(params[1])) ? [{}] : [] };
    }
    if (sql.includes('SELECT 1') && sql.includes('FROM public.pozo')) {
      assert.deepEqual(params, [90042, 7]);
      return { rows: estado.propio ? [{}] : [], rowCount: estado.propio ? 1 : 0 };
    }
    throw new Error('SQL no previsto: ' + sql);
  });
  const app = Fastify();
  t.after(() => app.close());
  await app.register(cookies);
  await app.register(jwt);
  const registradas: string[] = [];
  app.addHook('onRoute', route => {
    if (route.method === 'HEAD') return;
    registradas.push(`${route.method} ${route.url}`);
    assert.deepEqual(route.onRequest, [app.authenticate]);
    assert.deepEqual(route.preHandler, [app.pozoIsFromUser, app.puedeConsultarRecursos]);
    if (route.method === 'POST') assert.equal(route.config?.pozoSoloLectura, true);
    // Mantener schemas y hooks reales; aislar sólo el contenido después de autorizar.
    route.handler = async (_req, rep) => {
      estado.handlers++;
      return rep.code(204).send();
    };
  });
  await app.register(informes);
  await app.ready();
  const token = app.jwt.sign({ sub: 7, version_sesion: 1 }, { expiresIn: '1h' });
  return { app, estado, registradas, credenciales: { [SESSION_COOKIE]: token } };
}

test('GET legacy no registrados: informes y caracteristicas responden 404 sin consultar datos', async t => {
  const { app, estado, credenciales } = await fixture(t);
  for (const suffix of ['/informes', '/caracteristicas']) {
    for (const method of ['GET', 'HEAD'] as const) {
      assert.equal(app.hasRoute({ method, url: '/usuarios/:id_usuario/pozos/:id_pozo' + suffix }), false);
      for (const session of [undefined, credenciales]) {
        const response = await app.inject({ method, url: base + suffix, cookies: session });
        assert.equal(response.statusCode, 404, `${method} ${suffix}`);
      }
    }
  }
  assert.equal(estado.consultas, 0);
  assert.equal(estado.handlers, 0);
});

test('las cuatro rutas activas conservan registro, autenticación y control de acceso al pozo', async t => {
  const { app, estado, registradas, credenciales } = await fixture(t);
  assert.deepEqual(registradas.sort(), activas.map(r => `${r.method} /usuarios/:id_usuario/pozos/:id_pozo${r.suffix}`).sort());
  for (const route of activas) {
    const request = {
      method: route.method, url: base + route.suffix,
      ...(route.method === 'POST' ? { payload: borrador } : {}),
    };
    assert.equal(app.hasRoute({ method: request.method, url: '/usuarios/:id_usuario/pozos/:id_pozo' + route.suffix }), true);
    let handlersAntes = estado.handlers;
    assert.equal((await app.inject(request)).statusCode, 401, route.suffix);
    estado.activo = false;
    assert.equal((await app.inject({ ...request, cookies: credenciales })).statusCode, 401, route.suffix);
    estado.activo = true;
    estado.version = 2;
    assert.equal((await app.inject({ ...request, cookies: credenciales })).statusCode, 401, route.suffix);
    estado.version = 1;
    estado.roles = [];
    assert.equal((await app.inject({ ...request, cookies: credenciales })).statusCode, 403, route.suffix);
    assert.equal(estado.handlers, handlersAntes, 'Una sesión inválida o sin rol no alcanza el handler');

    for (const rol of ['propietario', 'perforador']) {
      estado.roles = [rol];
      estado.propio = false;
      handlersAntes = estado.handlers;
      assert.equal((await app.inject({ ...request, cookies: credenciales })).statusCode, 404, `${route.suffix}: pozo ajeno`);
      assert.equal(estado.handlers, handlersAntes);
      estado.propio = true;
      assert.equal((await app.inject({ ...request, cookies: credenciales })).statusCode, 204, `${route.suffix}: ${rol} autorizado`);
      assert.equal(estado.handlers, handlersAntes + 1);
    }
    estado.roles = ['administracion'];
    estado.propio = false;
    assert.equal((await app.inject({ ...request, cookies: credenciales })).statusCode, 204, `${route.suffix}: administración`);
  }
});
