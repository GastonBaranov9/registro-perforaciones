import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import jwt from '../src/plugins/jwt.ts';
import cookies, { SESSION_COOKIE } from '../src/plugins/cookies.ts';
import { myPool } from '../src/db/pool.ts';
import { exigirEdicionPozo, exigirEdicionSitio, puedeEditarCreacion, MENSAJE_EDICION_POZO } from '../src/services/edicion-pozo.ts';
import informes from '../src/routes/informes.ts';
import pozos from '../src/routes/pozos.ts';
import litologia from '../src/routes/intervalos-litologicos.ts';
import diametros from '../src/routes/intervalos-diametro-perforaciones.ts';
import filtros from '../src/routes/intervalos-filtro.ts';
import aportes from '../src/routes/niveles-aporte.ts';

const ahora = Date.parse('2026-10-02T12:00:00Z');
const propio = { creado_por: 7, fecha_creado: new Date(ahora - 86_399_999) };
test('ventana exacta, creador persistido y fechas inválidas', async () => {
  assert.equal(puedeEditarCreacion(propio, 7, ahora), true);
  assert.equal(puedeEditarCreacion(propio, 7, ahora + 1), false);
  assert.equal(puedeEditarCreacion(propio, 7, ahora + 2), false);
  assert.equal(puedeEditarCreacion(propio, 8, ahora), false);
  for (const fecha_creado of [null, 'inválida', new Date(ahora + 1)])
    assert.equal(puedeEditarCreacion({ ...propio, fecha_creado }, 7, ahora), false);
  assert.equal(puedeEditarCreacion({ ...propio, creado_por: null }, 7, ahora), false);
  const db = { query: async () => ({ rows: [propio] }) } as unknown as Pick<typeof myPool, 'query'>;
  await exigirEdicionPozo(1, 7, db, ahora);
  await assert.rejects(exigirEdicionPozo(1, 7, db, ahora + 1), { statusCode: 403 });
  await exigirEdicionSitio(1, 7, db, ahora);
  const compartido = { query: async () => ({ rows: [propio, { ...propio, creado_por: 8 }] }) } as unknown as typeof db;
  await assert.rejects(exigirEdicionSitio(1, 7, compartido, ahora), { statusCode: 403 });
  const viejo = { query: async () => ({ rows: [{ ...propio, fecha_creado: new Date(0) }] }) } as unknown as typeof db;
  await assert.rejects(exigirEdicionSitio(1, 7, viejo, ahora), { statusCode: 403 });
  const historico = { query: async () => ({ rows: [{ ...propio, origen:'historico' }] }) } as unknown as typeof db;
  await assert.rejects(exigirEdicionPozo(1,7,historico,ahora),{statusCode:403});
  await assert.rejects(exigirEdicionSitio(1,7,historico,ahora),{statusCode:403});
});

test('rutas reales: todas las mutaciones técnicas usan autorización, sesión activa y prioridad administrativa', async t => {
  process.env.FASTIFY_SECRET = 'test-edicion-pozo-secret-never-production';
  const app = Fastify();
  let roles = ['perforador'];
  let registro = { creado_por: 7, fecha_creado: new Date() };
  let activo = true;
  t.mock.method(myPool, 'query', async (sql: string, params: unknown[]) => {
    if (sql.includes('SELECT activo, version_sesion')) return { rows: [{ activo, version_sesion: 1 }] };
    if (sql.includes('FROM usuario_rol')) return { rows: roles.includes(String(params[1])) ? [{}] : [] };
    if (sql.includes('SELECT creado_por, fecha_creado')) { assert.deepEqual(params, [1]); return { rows: [registro] }; }
    if (sql.includes('SELECT 1') && sql.includes('public.pozo')) return { rows: [{}], rowCount: 1 };
    throw new Error('Consulta inesperada: ' + sql);
  });
  await app.register(cookies);
  await app.register(jwt);
  const mutaciones: { method: 'POST' | 'PUT' | 'DELETE'; url: string }[] = [];
  // Aislar autorización: conservar hooks reales y cortar antes de escribir en servicios.
  app.addHook('onRoute', route => {
    if (!['POST', 'PUT', 'DELETE'].includes(String(route.method)) || !route.url.includes(':id_pozo')) return;
    if (!route.url.startsWith('/usuarios/')) return;
    route.schema = { params: route.schema?.params };
    route.preValidation = [];
    const hooks = Array.isArray(route.preHandler) ? route.preHandler : route.preHandler ? [route.preHandler] : [];
    route.preHandler = [...hooks, async (_req, rep) => { rep.code(200).send({ autorizado: true }); }];
    if (route.config?.pozoSoloLectura) return;
    mutaciones.push({ method: route.method as 'POST' | 'PUT' | 'DELETE', url: route.url.replace(/:[a-z_]+/g, '1') });
  });
  for (const rutas of [pozos, litologia, diametros, filtros, aportes, informes]) await app.register(rutas);
  await app.ready();
  const token = app.jwt.sign({ sub: 7, version_sesion: 1 }, { expiresIn: '1h' });
  try {
    assert.equal(mutaciones.length, 17, 'inventario de escrituras de pozo, foto y cuatro familias técnicas');
    for (const route of mutaciones) {
      const borrarPozo = route.method === 'DELETE' && route.url === '/usuarios/1/pozos/1';
      for (const caso of ['propio reciente', 'propio vencido', 'ajeno', 'administracion', 'roles multiples', 'inactivo']) {
        roles = caso === 'administracion' ? ['administracion'] : caso === 'roles multiples' ? ['administracion', 'perforador', 'propietario'] : ['perforador'];
        activo = caso !== 'inactivo';
        registro = { creado_por: caso === 'ajeno' ? 8 : 7, fecha_creado: new Date(caso === 'propio reciente' || caso === 'ajeno' ? Date.now() - 1000 : 0) };
        const respuesta = await app.inject({ ...route, cookies: { [SESSION_COOKIE]: token } });
        const esperado = !activo ? 401 : roles.includes('administracion') || caso === 'propio reciente' && !borrarPozo ? 200 : 403;
        assert.equal(respuesta.statusCode, esperado, `${route.method} ${route.url}: ${caso}: ${respuesta.body}`);
        if (esperado === 403 && !borrarPozo) assert.ok(respuesta.json().message.includes(MENSAJE_EDICION_POZO));
      }
    }
    for (const rol of ['perforador', 'propietario']) {
      roles = [rol]; activo = true; registro.fecha_creado = new Date(0);
      const preview = await app.inject({ method: 'POST', url: '/usuarios/1/pozos/1/perfil-litologico/vista-previa', cookies: { [SESSION_COOKIE]: token } });
      assert.equal(preview.statusCode, 200, preview.body);
    }
  } finally { await app.close(); }
});
