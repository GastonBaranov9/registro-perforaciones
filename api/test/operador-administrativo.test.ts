import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { myPool } from '../src/db/pool.ts';
import jwt from '../src/plugins/jwt.ts';
import cookies, { SESSION_COOKIE } from '../src/plugins/cookies.ts';
import usuarios from '../src/routes/usuarios.ts';
import rolesRoutes from '../src/routes/roles.ts';
import pozos from '../src/routes/pozos.ts';
import historicos from '../src/routes/historicos.ts';
import sitios from '../src/routes/sitios.ts';
import numeracion from '../src/routes/numeracion-perforacion.ts';
import litologias from '../src/routes/litologias.ts';
import intervalos from '../src/routes/intervalos-litologicos.ts';
import diametros from '../src/routes/intervalos-diametro-perforaciones.ts';
import filtros from '../src/routes/intervalos-filtro.ts';
import aportes from '../src/routes/niveles-aporte.ts';
import informes from '../src/routes/informes.ts';
import { ROLES_CAPACIDAD, rolesPermiten, validarCompatibilidadRoles, validarIdsRolesCompatibles } from '../src/services/capacidades.ts';
import { contextoEscritura, iniciarEscrituraSesion } from '../src/services/escritura-sesion.ts';
import { crearHistorico, editarHistorico } from '../src/services/historicos-service.ts';
import { exigirAdministracionNumeracion } from '../src/services/numeracion-perforacion-service.ts';
import { createUsuario, updateUsuario } from '../src/services/usuarios-service.ts';
import { changeRol, updateRol } from '../src/services/roles-services.ts';

const operador = 'operador_administrativo';
const combinaciones = [['administracion'], [operador], ['perforador'], ['propietario'], [],
  [operador, 'perforador'], [operador, 'propietario'], [operador, 'perforador', 'propietario'],
  ['administracion', 'perforador', 'propietario']];

test('capacidades: mayúsculas conservan exactamente los permisos canónicos, sin aceptar nombres desconocidos', () => {
  for (const capacidad of Object.keys(ROLES_CAPACIDAD) as (keyof typeof ROLES_CAPACIDAD)[]) {
    for (const rol of ['administracion', operador, 'perforador', 'propietario']) {
      assert.equal(rolesPermiten([rol.toUpperCase()], capacidad), rolesPermiten([rol], capacidad));
    }
    for (const desconocido of [' administracion', 'administracion ', 'administración', 'superadministracion', 'operador', 'desconocido'])
      assert.equal(rolesPermiten([desconocido], capacidad), false, desconocido);
  }
  assert.equal(rolesPermiten(['Administracion'], 'administrarUsuarios'), true);
  assert.equal(rolesPermiten(['OPERADOR_ADMINISTRATIVO', 'PERFORADOR', 'PROPIETARIO'], 'administrarUsuarios'), false);
  assert.throws(() => validarCompatibilidadRoles(['Administracion', 'OPERADOR_ADMINISTRATIVO']), { statusCode: 400 });
});

test('capacidades: combinaciones no convierten al operador en administrador', () => {
  for (const roles of combinaciones) {
    const admin = roles.includes('administracion'), global = admin || roles.includes(operador);
    assert.equal(rolesPermiten(roles, 'operarTodosLosPozos'), admin);
    assert.equal(rolesPermiten(roles, 'gestionarHistoricos'), global);
    assert.equal(rolesPermiten(roles, 'escribirPozos'), global || roles.includes('perforador'));
    assert.equal(rolesPermiten(roles, 'administrarUsuarios'), admin);
    assert.doesNotThrow(() => validarCompatibilidadRoles(roles));
  }
  assert.throws(() => validarCompatibilidadRoles(['administracion', operador]), { statusCode: 400 });
});

test('HTTP real: inventario administrativo denegado y operaciones autorizadas con roles persistidos', async t => {
  process.env.FASTIFY_SECRET = 'operador-test-secret-never-production';
  let roles = [operador], activo = true, version = 1;
  t.mock.method(myPool, 'connect', () => { throw Error('Prohibida conexión real'); });
  t.mock.method(myPool, 'query', async (sql: string, params: unknown[]) => {
    if (sql.includes('SELECT origen FROM pozo')) return {rows:[{origen:'historico'}]};
    assert.equal(params[0], 7, 'el actor no se obtiene del parámetro URL 999');
    if (sql.includes('SELECT activo, version_sesion')) return { rows: [{ activo, version_sesion: version }] };
    if (sql.includes('SELECT r.nombre FROM rol r')) return { rows: roles.map(nombre => ({ nombre })) };
    if (sql.includes('FROM usuario_rol')) return { rows: roles.includes(String(params[1])) ? [{}] : [] };
    throw Error('SQL imprevisto: ' + sql);
  });
  const app = Fastify();
  t.after(() => app.close());
  await app.register(cookies); await app.register(jwt);
  const restringidas: { method: any; url: string }[] = [];
  const permitidas: { method: any; url: string }[] = [];
  // Probar los hooks reales de todas las rutas. Los servicios se prueban abajo;
  // aquí se elimina sólo validación de payload y efecto del handler.
  app.addHook('onRoute', route => {
    if (route.method === 'HEAD') return;
    const hooks = Array.isArray(route.preHandler) ? route.preHandler : [route.preHandler];
    const request = { method: route.method, url: route.url.replace(/:[a-z_]+/g, '999') };
    if (hooks.includes(app.userIsAdmin)) restringidas.push(request);
    if (hooks.some(h => [app.puedeOperarPozos, app.puedeGestionarHistoricos,
      app.puedeOperarTodosLosPozos, app.puedeConsultarRecursos].includes(h as any)) &&
      !route.url.includes('sitios') && !route.url.includes('mapas')) permitidas.push(request);
    route.schema = undefined; route.preValidation = [];
    route.handler = async (_req, rep) => rep.code(204).send();
  });
  for (const routes of [usuarios, rolesRoutes, pozos, historicos, sitios, numeracion, litologias,
    intervalos, diametros, filtros, aportes, informes]) await app.register(routes);
  await app.ready();
  const credentials = { [SESSION_COOKIE]: app.jwt.sign({ sub: 7, version_sesion: 1,
    roles: [{ id_rol: 1, nombre: 'administracion', descr: 'JWT no confiable para autorización' }] }, { expiresIn: '1h' }) };
  assert.ok(restringidas.length >= 25, `inventario: ${restringidas.length}`);
  assert.ok(permitidas.some(r => r.url.includes('historicos')));
  assert.ok(permitidas.some(r => r.url.includes('kml')));
  assert.ok(permitidas.some(r => r.url.includes('informe')));
  for (const conjunto of [[operador], [operador, 'perforador', 'propietario'], [], ['administracion']]) {
    roles = conjunto;
    for (const request of restringidas) {
      const response = await app.inject({ ...request, cookies: credentials });
      assert.equal(response.statusCode, roles.includes('administracion') ? 204 : 403,
        `${roles}: ${request.method} ${request.url}: ${response.body}`);
    }
  }
  roles = [operador];
  for (const request of permitidas) {
    const response = await app.inject({ ...request, cookies: credentials });
    assert.equal(response.statusCode, request.url.includes('kml') ? 403 : 204, `${request.method} ${request.url}: ${response.body}`);
  }
  for (const state of ['inactivo', 'revocado', 'sin rol']) {
    activo = state !== 'inactivo'; version = state === 'revocado' ? 2 : 1;
    roles = state === 'sin rol' ? [] : [operador];
    const response = await app.inject({ method: 'GET', url: '/pozos/exportar/kml', cookies: credentials });
    assert.equal(response.statusCode, state === 'sin rol' ? 403 : 401);
  }
});

test('HTTP: revocación entre autenticación y capacidades conserva 401, falta de rol conserva 403', async t => {
  process.env.FASTIFY_SECRET = 'operador-revocation-test-secret';
  let activo=true, version=1, revoke=false;
  t.mock.method(myPool,'connect',()=>{throw Error('No debe escribir');});
  t.mock.method(myPool,'query',async(sql:string)=>{
    if(sql.includes('SELECT activo, version_sesion')) return {rows:[{activo,version_sesion:version}]};
    if(sql.includes('FROM rol r')||sql.includes('FROM usuario_rol')) return {rows:[]};
    throw Error('SQL inesperado: '+sql);
  });
  const app=Fastify();t.after(()=>app.close());
  await app.register(cookies);await app.register(jwt);
  app.addHook('preValidation',async()=>{if(revoke){activo=false;version++;}});
  for(const [url,hook] of [['/capacidad',app.puedeOperarPozos],['/pozo/:id_pozo',app.pozoIsFromUser]] as const)
    app.put(url,{onRequest:[app.authenticate],preHandler:[hook]},async()=>{throw Error('No debe alcanzar el handler');});
  const credentials={[SESSION_COOKIE]:app.jwt.sign({sub:7,version_sesion:1},{expiresIn:'1h'})};
  for(const url of ['/capacidad','/pozo/1']) {
    activo=true;version=1;revoke=false;
    assert.equal((await app.inject({method:'PUT',url,cookies:credentials})).statusCode,403);
    revoke=true;
    assert.equal((await app.inject({method:'PUT',url,cookies:credentials})).statusCode,401);
  }
});

test('HTTP directo con schemas y payloads válidos: operador no alcanza servicios administrativos', async t => {
  process.env.FASTIFY_SECRET = 'operador-test-secret-never-production';
  t.mock.method(myPool, 'connect', () => { throw Error('No debe abrir transacción'); });
  t.mock.method(myPool, 'query', async (sql: string) => {
    if (sql.includes('SELECT activo, version_sesion')) return { rows: [{ activo: true, version_sesion: 1 }] };
    if (sql.includes('FROM usuario_rol')) return { rows: [] };
    throw Error('No debe consultar cuentas');
  });
  const app = Fastify(); t.after(() => app.close());
  await app.register(cookies); await app.register(jwt);
  for (const routes of [usuarios, rolesRoutes, pozos, numeracion, litologias]) await app.register(routes);
  const cuenta = { nombre: 'Intento', email: 'intento@example.test', password: 'ClaveDePrueba123!', activo: true,
    roles: [{ id_rol: 1, nombre: 'administracion', descr: 'Administración' }] };
  const roca = { codigo: 'prueba', nombre: 'Prueba', familia: 'otro', color: '#123456', patron: 'clay', orden: 1 };
  const requests: { method: any; url: string; payload?: any }[] = [
    { method: 'POST', url: '/usuarios', payload: cuenta },
    { method: 'PUT', url: '/usuarios/7', payload: cuenta }, // incluye contraseña y email propios
    { method: 'PUT', url: '/usuarios/99', payload: cuenta },
    { method: 'DELETE', url: '/usuarios/99' },
    { method: 'POST', url: '/usuarios/personas/99/acceso', payload: { email: cuenta.email, password: cuenta.password, confirmar: cuenta.password } },
    { method: 'DELETE', url: '/usuarios/personas/99' },
    { method: 'PUT', url: '/usuarios/7/roles/1' },
    { method: 'POST', url: '/roles', payload: { nombre: 'intento', descr: 'Intento' } },
    { method: 'PUT', url: '/roles/1', payload: { nombre: 'intento', descr: 'Intento' } },
    { method: 'DELETE', url: '/roles/1' },
    { method: 'GET', url: '/roles' },
    { method: 'PUT', url: '/pozos/numeracion', payload: { proximo: 5000, esperado: 3282 } },
    { method: 'GET', url: '/pozos/numeracion' },
    { method: 'PATCH', url: '/pozos/22/numero-perforacion', payload: { numero_perforacion: 123 } },
    { method: 'POST', url: '/litologias', payload: roca },
    { method: 'PUT', url: '/litologias/1', payload: roca },
    { method: 'PATCH', url: '/litologias/1/activar' },
    { method: 'PATCH', url: '/litologias/1/desactivar' },
    { method: 'GET', url: '/litologias?incluir_inactivas=true' },
    { method: 'DELETE', url: '/usuarios/99/pozos/22' },
    { method: 'POST', url: '/pozos/propietarios', payload: { nombre: 'Identidad prohibida' } },
    { method: 'PUT', url: '/pozos/propietarios/99', payload: { nombre: 'Identidad prohibida' } },
    { method: 'PUT', url: '/pozos/22/propietario', payload: { id_propietario: 99, id_propietario_esperado: null } },
  ];
  const credentials = { [SESSION_COOKIE]: app.jwt.sign({ sub: 7, version_sesion: 1 }, { expiresIn: '1h' }) };
  for (const request of requests) {
    const response = await app.inject({ ...request, cookies: credentials });
    assert.equal(response.statusCode, 403, `${request.method} ${request.url}: ${response.body}`);
  }
  // El catálogo no ofrece DELETE físico para ningún rol.
  assert.equal((await app.inject({ method: 'DELETE', url: '/litologias/1', cookies: credentials })).statusCode, 404);
});

test('transacciones: capacidad y sesión se revisan en la misma conexión, sin exención administrativa', async () => {
  let roles = [operador], version = 1, activo = true, nativa = true;
  const consultas: string[] = [];
  const db = { query: async (sql: string) => {
    consultas.push(sql);
    if (sql.includes('session-write-user-lock')) return { rows: [{ activo, cuenta_acceso: true, version_sesion: version }] };
    if (sql.includes('session-write-native-lock')) return { rows: nativa ? [{}] : [] };
    if (sql.includes('SELECT r.nombre')) return { rows: roles.map(nombre => ({ nombre })) };
    if (sql.includes('SELECT creado_por')) return { rows: [{ creado_por: 8, fecha_creado: new Date(0), origen: 'historico' }] };
    return { rows: [] };
  } } as any;
  const sesion = { idUsuario: 7, versionSesion: 1, idPozo: 22, capacidad: 'escribirPozos' as const };
  await contextoEscritura.run(sesion, () => iniciarEscrituraSesion(db));
  assert.ok(consultas.some(q => q.includes('session-write-user-lock')));
  assert.ok(consultas.some(q => q.includes('SELECT creado_por')));
  await assert.rejects(contextoEscritura.run({ ...sesion, capacidad: 'administrarUsuarios' }, () => iniciarEscrituraSesion(db, true)), { statusCode: 403 });
  for (const restantes of [[], ['propietario'], ['perforador']]) {
    roles = restantes;
    await assert.rejects(contextoEscritura.run(sesion, () => iniciarEscrituraSesion(db)), { statusCode: 403 });
  }
  roles = [operador]; version = 2;
  await assert.rejects(contextoEscritura.run(sesion, () => iniciarEscrituraSesion(db)), { statusCode: 401 });
  version = 1; activo = false;
  await assert.rejects(contextoEscritura.run(sesion, () => iniciarEscrituraSesion(db)), { statusCode: 401 });
  activo = true; nativa = false;
  await assert.rejects(contextoEscritura.run({ ...sesion, idSesionNativa: 4 }, () => iniciarEscrituraSesion(db)), { statusCode: 401 });
  await assert.rejects(contextoEscritura.run({ ...sesion, expiresAt: Date.now() - 1 }, () => iniciarEscrituraSesion(db)), { statusCode: 401 });
});

test('HTTP históricos: operador crea y edita con hooks, servicios y transacciones reales sobre SQL simulado', async t => {
  process.env.FASTIFY_SECRET = 'historicos-operador-test-never-production';
  let roles = [operador];
  const consultas: string[] = [];
  const epoca = '11111111-1111-4111-8111-111111111111';
  const client = { release() {}, query: async (sql: string) => {
    consultas.push(sql);
    if (sql.includes('SELECT activo, version_sesion')) return { rows: [{ activo: true, version_sesion: 1 }] };
    if (sql.includes('SELECT r.nombre')) return { rows: roles.map(nombre => ({ nombre })) };
    if (sql.includes('session-write-user-lock')) return { rows: [{ activo: true, cuenta_acceso: true, version_sesion: 1 }] };
    if (sql.includes('SELECT proximo')) return { rows: [{ proximo: 3282 }] };
    if (sql.includes('SELECT epoca') && !sql.includes('creacion_historica')) return { rows: [{ epoca }] };
    if (sql.includes('SELECT creado_por')) return {rows:[{creado_por:7,fecha_creado:new Date(),origen:'historico'}]};
    if (sql.includes('INSERT INTO pozo') || sql.includes('SELECT * FROM pozo')) return { rows: [{ id_pozo: 22, numero_perforacion: 123, origen: 'historico' }] };
    return { rows: [], rowCount: 0 };
  } };
  const pool = { connect: async () => client } as any;
  t.mock.method(myPool, 'query', client.query);
  t.mock.method(myPool, 'connect', pool.connect);
  const app = Fastify(); t.after(() => app.close());
  await app.register(cookies); await app.register(jwt); await app.register(historicos);
  const credentials = { [SESSION_COOKIE]: app.jwt.sign({ sub: 7, version_sesion: 1 }, { expiresIn: '1h' }) };
  const creado = await app.inject({ method: 'POST', url: '/pozos/historicos', cookies: credentials,
    headers: { 'idempotency-key': crypto.randomUUID(), 'x-epoca-datos': epoca }, payload: { numero_perforacion: 123 } });
  assert.equal(creado.statusCode, 201, creado.body);
  assert.equal(creado.json().id_pozo, 22);
  const editado = await app.inject({ method: 'PATCH', url: '/pozos/historicos/22', cookies: credentials, payload: { empresa: 'Dato histórico' } });
  assert.equal(editado.statusCode, 200, editado.body);
  assert.ok(consultas.some(q => q.includes('INSERT INTO pozo')));
  assert.ok(consultas.some(q => q.includes('UPDATE pozo SET empresa')));
  assert.ok(consultas.some(q => q.includes('session-write-user-lock')));
  assert.ok(!consultas.some(q => /(?:UPDATE|INSERT INTO) (?:public\.)?(?:numeracion_perforacion|numero_perforacion_reservado|usuario)/i.test(q)));
  await assert.rejects(exigirAdministracionNumeracion(7, client as any), { statusCode: 403 });
  roles = ['perforador'];
  await assert.rejects(crearHistorico(7, { numero_perforacion: 124 }, crypto.randomUUID(), epoca, pool), { statusCode: 403 });
  await assert.rejects(editarHistorico(7, 22, { empresa: 'No autorizado' }, pool), { statusCode: 403 });
});

test('cuentas y roles: alta, edición, asignación y renombrado rechazan la combinación y hacen rollback', async t => {
  let operacion = '', consultas: string[] = [];
  const client = { release() {}, query: async (sql: string) => {
    consultas.push(sql);
    if (sql.includes('SELECT nombre FROM rol WHERE id_rol = ANY')) return { rows: [{ nombre: 'administracion' }, { nombre: operador }] };
    if (sql.includes('SELECT id_usuario FROM usuario')) return { rows: [{ id_usuario: 7 }] };
    if (sql.includes('SELECT id_rol FROM usuario_rol')) return { rows: [{ id_rol: 1 }] };
    if (sql.includes('SELECT nombre FROM rol WHERE id_rol = $1')) return { rows: [{ nombre: 'rol-renombrable' }] };
    if (sql.includes('UPDATE rol')) return { rows: [{ id_rol: 9, nombre: operador }] };
    if (sql.includes('HAVING count(DISTINCT lower(r.nombre))')) return { rows: [{ id_usuario: 7 }] };
    if (/INSERT INTO (?:usuario|usuario_rol)|UPDATE usuario/.test(sql)) throw Error(`Escritura indebida: ${operacion}`);
    return { rows: [] };
  } };
  t.mock.method(myPool, 'connect', async () => client as any);
  const data = { nombre: 'Intento', email: 'test@example.test', password: 'ClaveDePrueba123!', activo: true,
    roles: [1, 4].map(id_rol => ({ id_rol, nombre: 'nombre-falso', descr: '' })) };
  for (const [nombre, ejecutar] of [
    ['crear', () => createUsuario(data)], ['editar', () => updateUsuario(data, 7)],
    ['asignar', () => changeRol(7, 4)], ['renombrar', () => updateRol({ nombre: operador, descr: '' }, 9)],
  ] as const) {
    operacion = nombre; consultas = [];
    await assert.rejects(ejecutar(), { statusCode: 400 }, nombre);
    assert.ok(consultas.some(q => q.includes('pg_advisory_xact_lock')), nombre);
    assert.ok(consultas.includes('ROLLBACK'), nombre);
    assert.ok(!consultas.includes('COMMIT'), nombre);
  }
});

test('roles incompatibles se validan por IDs del catálogo, sin confiar en nombres enviados', async () => {
  const db = { query: async (_sql: string, values: unknown[]) => {
    assert.deepEqual(values, [[1, 4]]);
    return { rows: [{ nombre: 'administracion' }, { nombre: operador }] };
  } } as any;
  await assert.rejects(validarIdsRolesCompatibles([1, 4], db), { statusCode: 400 });
});

test('HTTP alta normal y ubicación: operador usa su identidad, actor autenticado y número automático', async t => {
  process.env.FASTIFY_SECRET = 'normal-operador-test-never-production';
  const consultas: string[] = [];
  const sitio = { id_sitio: 33, departamento: 'Salto', localidad: 'Campo', latitud: '-31', longitud: '-57' };
  const pozo = { id_pozo: 22, numero_perforacion: 9000, id_propietario: null, propietario_provisional: 'Cliente',
    id_sitio: 33, id_perforador: 7, creado_por: 7, fecha_creado: new Date().toISOString() };
  const query = async (sql: string, params: any[] = []) => {
    consultas.push(sql);
    if (sql.includes('SELECT activo, version_sesion')) return { rows: [{ activo: true, version_sesion: 1 }] };
    if (sql.includes('session-write-user-lock')) return { rows: [{ activo: true, cuenta_acceso: true, version_sesion: 1 }] };
    if (sql.includes('SELECT r.nombre FROM rol r')) { assert.deepEqual(params, [7]); return { rows: [{ nombre: operador }] }; }
    if (sql.includes('FROM usuario_rol')) return { rows: [] };
    if (sql.includes('SELECT id_pozo FROM public.pozo WHERE id_sitio')) return { rows: [{ id_pozo: 22 }] };
    if (sql.includes('FROM rol r')) return { rows: [{ id_rol: 2, nombre: 'perforador' }] };
    if (sql.includes('FROM usuario u') && sql.includes('JOIN usuario_rol')) {
      assert.equal(params[0], 7); return { rows: [{ id_usuario: 7 }] };
    }
    if (sql.includes('INSERT INTO public.sitio') || sql.includes('UPDATE sitio')) return { rows: [sitio] };
    if (sql.includes('INSERT INTO public.pozo')) {
      assert.equal(params[3], 7); assert.equal(params[4], 7); assert.equal(params[16], null, 'sin número manual');
      return { rows: [pozo] };
    }
    if (sql.includes('SELECT creado_por')) return {rows:[{creado_por:7,fecha_creado:new Date(Date.now()-1000),origen:'normal'}]};
    if (sql.includes('SELECT 1 FROM sitio')) return { rows: [{}] };
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    throw Error('SQL no previsto: ' + sql);
  };
  t.mock.method(myPool, 'query', query);
  t.mock.method(myPool, 'connect', async () => ({ query, release() {} }) as any);
  const app = Fastify(); t.after(() => app.close());
  await app.register(cookies); await app.register(jwt);
  app.decorate('notifyClient', () => {});
  await app.register(pozos); await app.register(sitios);
  const credentials = { [SESSION_COOKIE]: app.jwt.sign({ sub: 7, version_sesion: 1 }, { expiresIn: '1h' }) };
  const payload = { pozo: { id_propietario: null, propietario_provisional: 'Cliente', id_perforador: 7 },
    sitio_nuevo: sitio, intervalos_litologicos: [], intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [] };
  const creado = await app.inject({ method: 'POST', url: '/usuarios/999/pozos/completo', cookies: credentials, payload });
  assert.equal(creado.statusCode, 201, creado.body);
  assert.equal(creado.json().pozo.creado_por, 7);
  assert.equal(creado.json().pozo.numero_perforacion, 9000, 'valor sintético devuelto por SQL simulado');
  const editado = await app.inject({ method: 'PUT', url: '/usuarios/999/sitios/33', cookies: credentials, payload: sitio });
  assert.equal(editado.statusCode, 200, editado.body);
  const manual = await app.inject({ method: 'POST', url: '/usuarios/999/pozos/completo', cookies: credentials,
    payload: { ...payload, pozo: { ...payload.pozo, numero_perforacion: 123 } } });
  assert.equal(manual.statusCode, 400, manual.body);
  assert.ok(!consultas.some(q => /(?:INSERT INTO|UPDATE).*numeracion_perforacion/.test(q)));
});
