import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import jwt from '../src/plugins/jwt.ts';
import cookies, { SESSION_COOKIE } from '../src/plugins/cookies.ts';
import { myPool } from '../src/db/pool.ts';
import { hashPassword } from '../src/services/password-service.ts';
import { logUser } from '../src/services/auth-services.ts';
import { crearSesionNative, emitirTicketWsNative, consumirTicketWsNative, validarSesionNativeParaWebsocket } from '../src/services/native-auth-service.ts';
import { clientConnections, registrarConexionWebsocket } from '../src/plugins/websocket.ts';
import roles from '../src/routes/roles.ts';
import usuarios from '../src/routes/usuarios.ts';
import pozos from '../src/routes/pozos.ts';
import sitios from '../src/routes/sitios.ts';
import litologia from '../src/routes/intervalos-litologicos.ts';
import diametros from '../src/routes/intervalos-diametro-perforaciones.ts';
import filtros from '../src/routes/intervalos-filtro.ts';
import aportes from '../src/routes/niveles-aporte.ts';
import informes from '../src/routes/informes.ts';
import numeracion from '../src/routes/numeracion-perforacion.ts';
import catalogo from '../src/routes/litologias.ts';
import native from '../src/routes/native-auth.ts';

const empleado = 7;
const administrador = 99;
const rol = { id_rol: 2, nombre: 'perforador', descr: 'Perforador' };
const pozoUrl = '/usuarios/7/pozos/1';

// Servicios y hooks reales; exclusivamente SQL simulado, sin PostgreSQL ni piloto.
async function fixture(t: TestContext, pausa?: { entered: () => void; wait: Promise<void> }) {
  process.env.FASTIFY_SECRET = 'fixture-security-audit-secret-never-production';
  const password = 'fixture-auditoria-123';
  const passwordHash = await hashPassword(password);
  const state = { activo: true, version: 1, guardados: 0, consultasSesion: 0 };
  let session: Record<string, any> | undefined;
  let ticketHash: Buffer | undefined;
  const fecha = new Date().toISOString();
  const query = async (source: string, values: any[] = []) => {
    const sql = source.replace(/\s+/g, ' ').trim();
    const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return result();
    if (sql.includes('session-write-native-lock')) return result([{ id_sesion_nativa: 11 }]);
    if (sql.includes('session-write-user-lock')) return result([{ activo: values[0] === administrador || state.activo, cuenta_acceso: true, version_sesion: values[0] === administrador ? 1 : state.version }]);
    if (sql.startsWith('SELECT activo, version_sesion')) {
      state.consultasSesion++;
      return result([{ activo: values[0] === administrador || state.activo, version_sesion: values[0] === administrador ? 1 : state.version }]);
    }
    if (sql.includes('WHERE email = $1') && sql.includes('password')) {
      assert.match(sql, /activo = TRUE/);
      return result(state.activo ? [{ id_usuario: empleado, email: 'perf@example.invalid', nombre: 'Perforador', password: passwordHash, version_sesion: state.version }] : []);
    }
    if (sql.includes('native-login-user-lock')) return result(state.activo ? [{ id_usuario: empleado, password: passwordHash, version_sesion: state.version }] : []);
    if (sql.startsWith('UPDATE sesion_nativa')) return result();
    if (sql.startsWith('SELECT count(*)')) return result([{ cantidad: 0 }]);
    if (sql.startsWith('INSERT INTO sesion_nativa')) {
      session = { id_sesion_nativa: 11, id_usuario: empleado, token_hash: values[1], version_sesion_emitida: values[3], platform: 'android', expires_at: new Date(Date.now() + 86_400_000) };
      return result([session]);
    }
    if (sql.includes('WHERE s.token_hash = $1')) {
      state.consultasSesion++;
      assert.match(sql, /u.activo = TRUE/);
      assert.match(sql, /s.version_sesion_emitida = u.version_sesion/);
      return result(session && state.activo && session.version_sesion_emitida === state.version && session.token_hash.equals(values[0]) ? [session] : []);
    }
    if (sql.startsWith('INSERT INTO ticket_ws_nativo')) { ticketHash = values[1]; return result([{ expires_at: new Date(Date.now() + 60_000) }]); }
    if (sql.includes('native-ws-ticket-discovery-no-lock')) return result(ticketHash?.equals(values[0]) ? [{ id_sesion_nativa: 11, id_usuario: empleado }] : []);
    if (sql.includes('native-ws-ticket-user-lock')) {
      assert.match(sql, /activo = TRUE/); assert.match(sql, /FOR UPDATE/);
      return result(state.activo ? [{ id_usuario: empleado, version_sesion: state.version }] : []);
    }
    if (sql.includes('u.activo, u.cuenta_acceso, u.version_sesion')) return result([{ ...session, activo: state.activo, cuenta_acceso: true, version_sesion: state.version }]);
    if (sql.startsWith('SELECT activo FROM usuario')) return result([{ activo: state.activo }]);
    if (sql.startsWith('SELECT id_rol FROM usuario_rol')) return result([{ id_rol: rol.id_rol }]);
    if (sql.startsWith('UPDATE usuario SET')) {
      assert.equal(values[0], empleado);
      state.activo = values[3];
      if (values[5]) state.version++;
      return result([{ id_usuario: empleado, email: values[1], nombre: values[2], activo: state.activo, fecha_registro: fecha }]);
    }
    if (sql.includes('FROM usuario_rol ur')) return result((values[0] === administrador ? values[1] === 'administracion' : values[1] === 'perforador') ? [{}] : []);
    if (sql.includes('FROM rol r')) return result([values[0] === 3 ? { ...rol, nombre: 'propietario' } : rol]);
    if (sql.startsWith('SELECT creado_por, fecha_creado')) return result([{ creado_por: empleado, fecha_creado: fecha }]);
    if (sql.startsWith('SELECT 1') && sql.includes('public.pozo')) return result([{}]);
    if (sql.startsWith('UPDATE public.pozo')) {
      state.guardados++;
      return result([{ id_pozo: 1, id_propietario: 3, id_perforador: empleado, id_sitio: 1, creado_por: empleado, fecha_creado: fecha }]);
    }
    throw new Error('SQL sin simular: ' + sql);
  };
  t.mock.method(myPool, 'query', query);
  t.mock.method(myPool, 'connect', async () => ({ query, release() {} }));
  const app = Fastify();
  await app.register(cookies);
  await app.register(jwt);
  for (const name of ['notifyClient', 'notifyAdmin', 'rateLimitNativeLogin', 'rateLimitLogin', 'rateLimitNativeWsTicket']) app.decorate(name, async () => {});
  const routes: { method: string; url: string }[] = [];
  if (pausa) app.addHook('preValidation', async req => {
    if (req.method === 'PUT' && req.url === pozoUrl) { pausa.entered(); await pausa.wait; }
  });
  app.addHook('onRoute', route => {
    if (route.method === 'HEAD') return;
    routes.push({ method: String(route.method), url: route.url });
    // No necesitamos persistir otras operaciones para verificar su autenticación.
    // PUT usuario y PUT pozo conservan handler, schemas y servicios íntegros.
    if (route.method === 'PUT' && ['/usuarios/:id_usuario', '/usuarios/:id_usuario/pozos/:id_pozo'].includes(route.url)) return;
    route.handler = async (_req, rep) => rep.code(204).send();
  });
  for (const plugin of [roles, usuarios, pozos, sitios, litologia, diametros, filtros, aportes, informes, numeracion, catalogo, native]) await app.register(plugin);
  await app.ready();
  t.after(async () => { clientConnections.splice(0); await app.close(); });
  const identity = await logUser('perf@example.invalid', password);
  const token = app.jwt.sign({ sub: identity.id_usuario, version_sesion: identity.version_sesion }, { expiresIn: '1h' });
  const issued = await crearSesionNative({ email: 'perf@example.invalid', password, installationId: '12345678-1234-4234-8234-123456789abc', platform: 'android', appBuild: 1 });
  const admin = app.jwt.sign({ sub: administrador, version_sesion: 1 }, { expiresIn: '1h' });
  const credentials = {
    web: { cookies: { [SESSION_COOKIE]: token } },
    android: { headers: { authorization: `Bearer ${issued.token}`, 'x-native-platform': 'android', 'x-native-app-build': '1' } },
  };
  const cambiarEstado = async (activo: boolean) => {
    const response = await app.inject({ method: 'PUT', url: '/usuarios/7', cookies: { [SESSION_COOKIE]: admin }, payload: { email: 'perf@example.invalid', nombre: 'Perforador', activo, roles: [rol] } });
    assert.equal(response.statusCode, 200, response.body);
  };
  return { app, routes, state, credentials, issued, cambiarEstado };
}

test('sesiones emitidas: desactivación administrativa rechaza nuevas lecturas y escrituras web/Android; reactivar no revive tokens', async t => {
  const f = await fixture(t);
  for (const credentials of Object.values(f.credentials)) {
    assert.equal((await f.app.inject({ method: 'GET', url: pozoUrl, ...credentials })).statusCode, 204);
    assert.equal((await f.app.inject({ method: 'POST', url: '/usuarios/7/pozos/completo', ...credentials, payload: { pozo: { id_propietario: null, propietario_provisional: 'Provisional', id_perforador: empleado }, sitio_nuevo: { departamento: 'Salto', latitud: '-31', longitud: '-57' }, intervalos_litologicos: [], intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [] } })).statusCode, 204);
    assert.equal((await f.app.inject({ method: 'PUT', url: pozoUrl, ...credentials, payload: { id_propietario: 3, id_perforador: empleado, id_sitio: 1 } })).statusCode, 200);
  }
  const ticket = await emitirTicketWsNative(f.issued, { platform: 'android', appBuild: 1 });
  const wsIdentity = { ...f.issued, appBuildEmitido: 1 };
  assert.equal(await validarSesionNativeParaWebsocket(wsIdentity), true);
  const closeCodes: number[] = [];
  registrarConexionWebsocket({ id_usuario: empleado, socket: { readyState: 1, send() {}, ping() {}, terminate() {}, on() {}, close(code) { closeCodes.push(code!); } }, auth: { kind: 'native', versionSesion: 1, nativeSessionId: 11 } });
  await f.cambiarEstado(false);
  assert.equal(f.state.activo, false);
  assert.equal(f.state.version, 2);
  assert.deepEqual(closeCodes, [4003]);
  assert.equal(await validarSesionNativeParaWebsocket(wsIdentity), false);
  assert.equal(await consumirTicketWsNative(ticket.ticket), null, 'ticket emitido antes de desactivar no reconecta');
  // Todas las rutas del dominio, incluyendo lecturas, creación y administración.
  const domainRoutes = f.routes.filter(r => !r.url.startsWith('/auth/') || ['/auth/native/session', '/auth/native/ws-ticket'].includes(r.url));
  const writesBefore = f.state.guardados;
  for (const route of domainRoutes) for (const credentials of Object.values(f.credentials)) {
    const response = await f.app.inject({ method: route.method as any, url: route.url.replace(/:[a-z_]+/g, '1'), ...credentials });
    assert.equal(response.statusCode, 401, `${route.method} ${route.url}: ${response.body}`);
  }
  assert.equal(f.state.guardados, writesBefore);
  await f.cambiarEstado(true);
  for (const credentials of Object.values(f.credentials)) assert.equal((await f.app.inject({ method: 'GET', url: pozoUrl, ...credentials })).statusCode, 401);
  assert.ok(f.state.consultasSesion >= domainRoutes.length * 2);
  writeFileSync(join(tmpdir(), 'rsp-security-audit-routes.json'), JSON.stringify(f.routes, null, 2));
  t.diagnostic(`${domainRoutes.length} rutas comprobadas con ambas sesiones previamente emitidas.`);
});

for (const mechanism of ['web', 'android'] as const) test(`sesión ${mechanism}: PUT ya autenticado se rechaza después de la desactivación`, async t => {
  let entered!: () => void;
  let resume!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { resume = resolve; });
  const f = await fixture(t, { entered, wait });
  const pending = f.app.inject({ method: 'PUT', url: pozoUrl, ...f.credentials[mechanism], payload: { id_propietario: 3, id_perforador: empleado, id_sitio: 1 } }).then(r => r);
  await reached;
  try { await f.cambiarEstado(false); } finally { resume(); }
  const response = await pending;
  assert.equal(response.statusCode, 401, response.body);
  assert.equal(f.state.activo, false);
  assert.equal(f.state.guardados, 0, 'la sesión revocada no alcanza la mutación');
  assert.equal((await f.app.inject({ method: 'GET', url: pozoUrl, ...f.credentials[mechanism] })).statusCode, 401);
});
