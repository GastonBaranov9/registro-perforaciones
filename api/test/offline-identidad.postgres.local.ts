// Sólo PostgreSQL desechable: no carga .env ni se conecta al puerto habitual.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { ejecutarMigraciones } from '../src/db/migrator.ts';

test('014: flujo offline e identidad con PostgreSQL 16 aislado', async t => {
  const port = Number(process.env.RSP14_TEST_PORT);
  assert.ok(Number.isInteger(port) && port > 1024 && port !== 5432);
  const db = `rsp14_${process.pid}_${Date.now()}`;
  const control = new Pool({ host: '127.0.0.1', port, user: 'rsp14_test', database: 'postgres' });
  await control.query(`CREATE DATABASE ${db}`);
  const pool = new Pool({ host: '127.0.0.1', port, user: 'rsp14_test', database: db });
  const fotos = await fs.mkdtemp(path.join(os.tmpdir(), 'rsp14-photos-'));
  Object.assign(process.env, { PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'rsp14_test', PGDATABASE: db, NODE_ENV: 'test', FOTOS_DIR: fotos, FASTIFY_SECRET: 'isolated-rsp14-test-key-not-a-real-credential' });
  const { myPool } = await import('../src/db/pool.ts');
  const { hashPassword } = await import('../src/services/password-service.ts');
  const { crearSesionNative, revocarSesionNativePorToken } = await import('../src/services/native-auth-service.ts');
  const { logUser } = await import('../src/services/auth-services.ts');
  const app = Fastify();
  try {
    await t.test('migrador oficial aplica 000–015 y repetir no cambia datos', async () => {
      const applied = (await ejecutarMigraciones(pool)).aplicadas;
      assert.ok(applied.includes('014_offline_identidad.sql'));
      assert.ok(applied.includes('015_offline_claves_cerradas.sql'));
      assert.deepEqual((await ejecutarMigraciones(pool)).aplicadas, []);
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo, null);
    });
    await pool.query(`INSERT INTO usuario(id_usuario,email,nombre,password) VALUES
      (1,'admin@test.local','Admin',$1),(2,'perf@test.local','Perforador',$1),(3,'otro@test.local','Otro',$1);
    `, [await hashPassword('isolated-test-password')]);
    await pool.query(`INSERT INTO usuario_rol SELECT 1,id_rol FROM rol WHERE nombre='administracion';
      INSERT INTO usuario_rol SELECT 2,id_rol FROM rol WHERE nombre='perforador';
      INSERT INTO usuario_rol SELECT 3,id_rol FROM rol WHERE nombre='perforador';
      SELECT setval(pg_get_serial_sequence('usuario','id_usuario'),3);`);
    await app.register(cookie);
    await app.register((await import('../src/plugins/jwt.ts')).default);
    await app.register((await import('../src/plugins/error-handler.ts')).default);
    app.decorate('notifyClient', () => {}); app.decorate('notifyAdmin', () => {});
    app.decorate('rateLimitLogin', async () => {});
    app.decorate('rateLimitNativeWsTicket', async () => {});
    await app.register((await import('../src/routes/pozos.ts')).default);
    await app.register((await import('../src/routes/usuarios.ts')).default);
    await app.register((await import('../src/routes/roles.ts')).default);
    await app.register((await import('../src/routes/login.ts')).default);
    await app.register((await import('../src/routes/native-auth.ts')).default);
    await app.ready();
    const { SESSION_COOKIE } = await import('../src/plugins/cookies.ts');
    const epoca = (await pool.query('SELECT epoca FROM epoca_datos')).rows[0].epoca;
    const call = (id: number, method: 'POST'|'GET'|'PUT'|'DELETE', url: string, payload?: object, key?: string, version = 1) => app.inject({ method, url,
      cookies: { [SESSION_COOKIE]: app.jwt.sign({ sub: id, version_sesion: version }, { expiresIn: '1h' }) },
      headers: { 'x-epoca-datos': epoca, ...(key ? { 'idempotency-key': key } : {}) }, ...(payload ? { payload } : {}) });
    const datos = {
      pozo: { id_propietario: null, propietario_provisional: 'Persona de campo', id_perforador: 2, profundidad_final_m: 30 },
      sitio_nuevo: { departamento: 'Salto', localidad: 'Campo', latitud: '-31', longitud: '-57' },
      intervalos_litologicos: [], intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
      foto: { mime_type: 'image/png' as const, base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' },
    };
    const key = randomUUID(); let idPozo: number;
    await t.test('sin numeración configurada conserva NULL y no registra éxito', async () => {
      const result = await call(2, 'POST', '/usuarios/2/pozos/completo', datos, key);
      assert.notEqual(result.statusCode, 201);
      assert.equal((await pool.query('SELECT count(*) FROM pozo')).rows[0].count, '0');
      assert.equal((await pool.query('SELECT count(*) FROM creacion_offline')).rows[0].count, '0');
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo, null);
    });
    // Numeración ficticia EXCLUSIVAMENTE en la base nueva del laboratorio.
    await pool.query('UPDATE numeracion_perforacion SET proximo=8000');
    await t.test('concurrencia, respuesta perdida y reintento consumen un solo número y una foto', async () => {
      const responses = await Promise.all(Array.from({ length: 4 }, () => call(2, 'POST', '/usuarios/2/pozos/completo', datos, key)));
      for (const response of responses) assert.equal(response.statusCode, 201, response.body);
      const result = responses[0].json(); idPozo = result.pozo.id_pozo;
      for (const response of responses) assert.deepEqual(response.json(), result);
      assert.equal(result.pozo.numero_perforacion, 8000);
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo, '8001');
      assert.equal((await pool.query('SELECT count(*) FROM creacion_offline')).rows[0].count, '1');
      assert.ok((await fs.readdir(fotos)).includes(`pozo-${idPozo}.png`));
      const replay = await call(2, 'POST', '/usuarios/2/pozos/completo', datos, key);
      assert.deepEqual(replay.json(), result);
    });
    await t.test('rechaza payload distinto, número comercial forjado y otro perforador', async () => {
      assert.equal((await call(2, 'POST', '/usuarios/2/pozos/completo', { ...datos, pozo: { ...datos.pozo, profundidad_final_m: 50 } }, key)).statusCode, 400);
      assert.equal((await call(2, 'POST', '/usuarios/2/pozos/completo', { ...datos, pozo: { ...datos.pozo, numero_perforacion: 3001 } }, randomUUID())).statusCode, 403);
      assert.equal((await call(3, 'POST', '/usuarios/2/pozos/completo', datos, randomUUID())).statusCode, 403);
    });
    await t.test('fallo intermedio no deja idempotencia ni consume numeración', async () => {
      const failureKey = randomUUID();
      const bad = { ...datos, foto: { mime_type: 'image/png', base64: 'AAAA' } };
      assert.equal((await call(2, 'POST', '/usuarios/2/pozos/completo', bad, failureKey)).statusCode, 400);
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo, '8001');
      assert.equal((await call(2, 'POST', '/usuarios/2/pozos/completo', datos, failureKey)).statusCode, 201);
    });
    let propietario: number;
    await t.test('error 500 después de guardar foto revierte transacción; el mismo UUID puede reintentarse', async () => {
      const failKey = randomUUID();
      const before = (await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo;
      await pool.query(`CREATE FUNCTION fallo_offline_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fallo aislado de prueba'; END $$;
        CREATE TRIGGER fallo_offline_test BEFORE INSERT ON creacion_offline FOR EACH ROW EXECUTE FUNCTION fallo_offline_test()`);
      assert.equal((await call(2, 'POST', '/usuarios/2/pozos/completo', datos, failKey)).statusCode, 500);
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo, before);
      await pool.query('DROP TRIGGER fallo_offline_test ON creacion_offline; DROP FUNCTION fallo_offline_test()');
      const retry = await call(2, 'POST', '/usuarios/2/pozos/completo', datos, failKey);
      assert.equal(retry.statusCode, 201, retry.body);
      assert.equal(retry.json().pozo.numero_perforacion, Number(before));
    });
    await t.test('provisional a identidad nueva; homónimos separados; sin password', async () => {
      const uno = await call(1, 'POST', '/pozos/propietarios', { nombre: 'Mismo nombre', documento_rut: 'DOC-A' });
      const dos = await call(1, 'POST', '/pozos/propietarios', { nombre: 'Mismo nombre', documento_rut: 'DOC-B' });
      assert.equal(uno.statusCode, 201, uno.body); assert.equal(dos.statusCode, 201, dos.body);
      propietario = uno.json().id_usuario;
      assert.notEqual(propietario, dos.json().id_usuario);
      assert.equal((await pool.query('SELECT password FROM usuario WHERE id_usuario=$1', [propietario])).rows[0].password, null);
      const link = await call(1, 'PUT', `/pozos/${idPozo}/propietario`, { id_propietario: propietario, id_propietario_esperado: null });
      assert.equal(link.statusCode, 200, link.body);
      const row = (await pool.query('SELECT * FROM pozo WHERE id_pozo=$1', [idPozo])).rows[0];
      assert.equal(row.propietario_provisional, null); assert.equal(row.propietario_provisional_original, 'Persona de campo');
      assert.equal((await call(1, 'PUT', `/pozos/${idPozo}/propietario`, { id_propietario: dos.json().id_usuario, id_propietario_esperado: null })).statusCode, 400);
      assert.equal((await call(2, 'PUT', `/pozos/${idPozo}/propietario`, { id_propietario: dos.json().id_usuario, id_propietario_esperado: propietario })).statusCode, 403);
    });
    await t.test('crear acceso, login, rol propietario y login duplicado; nunca retorna hashes', async () => {
      const body = { email: 'owner@test.local', password: 'initial-owner-test', confirmar: 'initial-owner-test' };
      assert.equal((await call(2, 'POST', `/usuarios/personas/${propietario}/acceso`, body)).statusCode, 403);
      assert.equal((await call(1, 'POST', `/usuarios/personas/${propietario}/acceso`, body)).statusCode, 204);
      const logged = await logUser(body.email, body.password);
      assert.equal(Number(logged.id_usuario), propietario); assert.equal('password' in logged, false);
      const publicUser = await call(1, 'GET', `/usuarios/${propietario}`);
      assert.equal(publicUser.json().roles.some((r: any) => r.nombre === 'propietario'), true);
      assert.equal(publicUser.body.includes('password'), false); assert.equal(publicUser.body.includes('$2'), false);
      const other = await call(1, 'POST', '/pozos/propietarios', { nombre: 'Otro propietario' });
      assert.equal((await call(1, 'POST', `/usuarios/personas/${other.json().id_usuario}/acceso`, body)).statusCode, 400);
      const own = await call(propietario, 'GET', `/usuarios/${propietario}/pozos`, undefined, undefined, 2);
      assert.equal(own.statusCode, 200, own.body);
      assert.equal(JSON.stringify(own.json()).includes(String(idPozo)), true);
      assert.deepEqual((await call(propietario, 'GET', '/usuarios/2/pozos', undefined, undefined, 2)).json(), own.json());
      assert.deepEqual(own.json().map((p: any) => p.id_pozo), [idPozo]);
    });
    await t.test('edición tardía y formalización desde otro cliente rechazan cambios', async () => {
      await pool.query("UPDATE pozo SET fecha_creado=now()-interval '25 hours' WHERE id_pozo=$1", [idPozo]);
      const site = (await pool.query('SELECT id_sitio FROM pozo WHERE id_pozo=$1', [idPozo])).rows[0].id_sitio;
      const edit = await call(2, 'PUT', `/usuarios/2/pozos/${idPozo}/completo`, { ...datos, pozo: { ...datos.pozo, id_sitio: Number(site) }, foto_accion: 'conservar', foto: undefined });
      assert.equal(edit.statusCode, 403, edit.body);
    });
    await t.test('password vacío, inferior al mínimo, confirmación distinta y más de 72 bytes se rechazan sin crear acceso', async () => {
      const persona = (await call(1, 'POST', '/pozos/propietarios', { nombre: 'Control passwords' })).json().id_usuario;
      for (const [password, confirmar] of [['', ''], ['1234567', '1234567'], ['12345678', '87654321'], ['a'.repeat(73), 'a'.repeat(73)], ['á'.repeat(37), 'á'.repeat(37)]]) {
        const res = await call(1, 'POST', `/usuarios/personas/${persona}/acceso`, { email: 'minimum@test.local', password, confirmar });
        assert.equal(res.statusCode, 400, res.body);
        assert.deepEqual((await pool.query('SELECT cuenta_acceso,password FROM usuario WHERE id_usuario=$1', [persona])).rows[0], { cuenta_acceso: false, password: null });
      }
      assert.equal((await call(1, 'POST', `/usuarios/personas/${persona}/acceso`, { email: 'minimum@test.local', password: '12345678', confirmar: '12345678' })).statusCode, 204);
      assert.equal(Number((await logUser('minimum@test.local', '12345678')).id_usuario), persona);
    });
    await t.test('email: CITEXT impide OWNER@TEST.LOCAL duplicado; login web/native son equivalentes y rechazan espacios', async () => {
      const persona = (await call(1, 'POST', '/pozos/propietarios', { nombre: 'Control email' })).json().id_usuario;
      const password = 'initial-owner-test';
      const duplicate = await call(1, 'POST', `/usuarios/personas/${persona}/acceso`, { email: 'OWNER@TEST.LOCAL', password, confirmar: password });
      assert.equal(duplicate.statusCode, 400, duplicate.body);
      assert.equal((await pool.query('SELECT cuenta_acceso FROM usuario WHERE id_usuario=$1', [persona])).rows[0].cuenta_acceso, false);
      await assert.rejects(pool.query("INSERT INTO usuario(email,nombre,password) VALUES('OWNER@TEST.LOCAL','Duplicado','hash-prueba')"), (e: any) => e.code === '23505');
      assert.equal(Number((await logUser('OWNER@TEST.LOCAL', password)).id_usuario), propietario);
      const nativeHeaders = { 'x-native-platform': 'android', 'x-native-app-build': '999' };
      for (const email of ['owner@test.local', 'OWNER@TEST.LOCAL']) {
        assert.equal((await app.inject({ method: 'POST', url: '/login', payload: { email, password } })).statusCode, 200);
        const native = await app.inject({ method: 'POST', url: '/auth/native/login', headers: nativeHeaders, payload: { email, password, installation_id: randomUUID() } });
        assert.equal(native.statusCode, 200, native.body); assert.equal(native.json().user.id_usuario, propietario);
      }
      for (const email of [' owner@test.local', 'owner@test.local ', ' OWNER@TEST.LOCAL ']) {
        assert.equal((await call(1, 'POST', `/usuarios/personas/${persona}/acceso`, { email, password, confirmar: password })).statusCode, 400);
        assert.equal((await app.inject({ method: 'POST', url: '/login', payload: { email, password } })).statusCode, 400);
        assert.equal((await app.inject({ method: 'POST', url: '/auth/native/login', headers: nativeHeaders, payload: { email, password, installation_id: randomUUID() } })).statusCode, 400);
      }
    });
    await t.test('rechazo definitivo: cierre durable bloquea solicitudes atrasadas; nueva operación corregida puede crear', async () => {
      const rejected = randomUUID();
      assert.equal((await call(2, 'POST', '/usuarios/2/pozos/completo', { ...datos, foto: { mime_type: 'image/png', base64: 'AAAA' } }, rejected)).statusCode, 400);
      const cierre = await call(2, 'POST', `/pozos/offline/${rejected}/cerrar`, {});
      assert.deepEqual(cierre.json(), { estado: 'cerrado_sin_creacion', clave: rejected });
      assert.deepEqual((await call(2, 'POST', `/pozos/offline/${rejected}/cerrar`, {})).json(), cierre.json());
      const before = (await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo;
      const late = await call(2, 'POST', '/usuarios/2/pozos/completo', datos, rejected);
      assert.equal(late.statusCode, 409); assert.equal(late.json().code, 'OFFLINE_CLAVE_CERRADA');
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo, before);
      assert.equal((await call(2, 'POST', '/usuarios/2/pozos/completo', datos, randomUUID())).statusCode, 201);
    });
    await t.test('cierre después de respuesta perdida devuelve el recibo, sin habilitar otra creación', async () => {
      const cierre = await call(2, 'POST', `/pozos/offline/${key}/cerrar`, {});
      assert.equal(cierre.json().estado, 'confirmado'); assert.equal(cierre.json().resultado.pozo.id_pozo, idPozo);
      assert.equal((await pool.query('SELECT 1 FROM clave_offline_cerrada WHERE actor=2 AND clave=$1', [key])).rowCount, 0);
    });
    await t.test('crear y cerrar simultáneamente tienen un único desenlace bajo el mismo lock', async () => {
      for (let n = 0; n < 4; n++) {
        const racing = randomUUID();
        const [creation, closure] = await Promise.all([
          call(2, 'POST', '/usuarios/2/pozos/completo', datos, racing.toUpperCase()),
          call(2, 'POST', `/pozos/offline/${racing}/cerrar`, {}),
        ]);
        assert.equal(closure.statusCode, 200, closure.body);
        if (closure.json().estado === 'confirmado') {
          assert.equal(creation.statusCode, 201); assert.equal(creation.json().pozo.id_pozo, closure.json().resultado.pozo.id_pozo);
        } else {
          assert.equal(closure.json().estado, 'cerrado_sin_creacion'); assert.equal(creation.statusCode, 409);
        }
        const rows = await pool.query('SELECT (SELECT count(*) FROM creacion_offline WHERE actor=2 AND clave=$1) + (SELECT count(*) FROM clave_offline_cerrada WHERE actor=2 AND clave=$1) AS total', [racing]);
        assert.equal(rows.rows[0].total, '1');
      }
    });
    await t.test('revocación nativa rechaza incluso replay confirmado; múltiples teléfonos', async () => {
      const session = await crearSesionNative({ email: 'perf@test.local', password: 'isolated-test-password', installationId: randomUUID(), platform: 'android', appBuild: 999 });
      const another = await crearSesionNative({ email: 'perf@test.local', password: 'isolated-test-password', installationId: randomUUID(), platform: 'android', appBuild: 999 });
      const send = (token: string) => app.inject({ method: 'POST', url: '/usuarios/2/pozos/completo', payload: datos, headers: { authorization: `Bearer ${token}`, 'x-native-platform': 'android', 'x-native-app-build': '999', 'idempotency-key': key, 'x-epoca-datos': epoca } });
      assert.equal((await send(session.token)).statusCode, 201);
      await revocarSesionNativePorToken(session.token);
      assert.equal((await send(session.token)).statusCode, 401);
      assert.equal((await send(another.token)).statusCode, 201);
    });
    await t.test('pérdida de rol, cuenta desactivada y sesión vencida rechazan sincronización', async () => {
      await pool.query('UPDATE usuario SET version_sesion=version_sesion+1 WHERE id_usuario=2');
      assert.equal((await call(2, 'POST', '/usuarios/2/pozos/completo', datos, key)).statusCode, 401);
      await pool.query('DELETE FROM usuario_rol WHERE id_usuario=2');
      assert.equal((await call(2, 'POST', '/usuarios/2/pozos/completo', datos, key, 2)).statusCode, 403);
      const forbiddenClosure = randomUUID();
      assert.equal((await call(2, 'POST', `/pozos/offline/${forbiddenClosure}/cerrar`, {}, undefined, 2)).statusCode, 403);
      assert.equal((await pool.query('SELECT 1 FROM clave_offline_cerrada WHERE clave=$1', [forbiddenClosure])).rowCount, 0);
      await pool.query("INSERT INTO usuario_rol SELECT 2,id_rol FROM rol WHERE nombre='perforador'; UPDATE usuario SET activo=FALSE WHERE id_usuario=2");
      assert.equal((await call(2, 'POST', '/usuarios/2/pozos/completo', datos, key, 2)).statusCode, 401);
      await pool.query('UPDATE usuario SET activo=TRUE WHERE id_usuario=2');
      const expired = await app.inject({ method: 'POST', url: '/usuarios/2/pozos/completo', payload: datos, cookies: { [SESSION_COOKIE]: app.jwt.sign({ sub: 2, version_sesion: 2 }, { expiresIn: -1 }) }, headers: { 'idempotency-key': key } });
      assert.equal(expired.statusCode, 401);
    });
    await t.test('eliminar acceso conserva pozos, fotos, reservas y revoca login/sincronización', async () => {
      const before = (await pool.query('SELECT * FROM pozo ORDER BY id_pozo')).rows;
      const numeros = (await pool.query('SELECT * FROM numero_perforacion_reservado ORDER BY numero_perforacion')).rows;
      assert.equal((await call(3, 'DELETE', '/usuarios/2')).statusCode, 403);
      assert.equal((await call(1, 'DELETE', '/usuarios/2')).statusCode, 204);
      assert.deepEqual((await pool.query('SELECT * FROM pozo ORDER BY id_pozo')).rows, before);
      assert.deepEqual((await pool.query('SELECT * FROM numero_perforacion_reservado ORDER BY numero_perforacion')).rows, numeros);
      assert.ok((await fs.stat(path.join(fotos, `pozo-${idPozo}.png`))).size > 0);
      await assert.rejects(logUser('perf@test.local', 'isolated-test-password'));
      assert.equal((await call(2, 'POST', '/usuarios/2/pozos/completo', datos, key, 3)).statusCode, 401);
      assert.equal((await call(1, 'DELETE', '/usuarios/personas/2')).statusCode, 400);
    });
    await t.test('identidad sin dependencias puede borrarse; acceso activo no', async () => {
      assert.equal((await call(1, 'DELETE', '/usuarios/personas/3')).statusCode, 400);
      const empty = await call(1, 'POST', '/pozos/propietarios', { nombre: 'Identidad de prueba sin historial' });
      const id = empty.json().id_usuario;
      assert.equal((await call(2, 'DELETE', `/usuarios/personas/${id}`)).statusCode, 401);
      assert.equal((await call(1, 'DELETE', `/usuarios/personas/${id}`)).statusCode, 204);
      assert.equal((await pool.query('SELECT 1 FROM usuario WHERE id_usuario=$1', [id])).rowCount, 0);
    });
    const adminRole = (await pool.query("SELECT * FROM rol WHERE nombre='administracion'")).rows[0];
    const perfRole = (await pool.query("SELECT * FROM rol WHERE nombre='perforador'")).rows[0];
    adminRole.id_rol = Number(adminRole.id_rol); perfRole.id_rol = Number(perfRole.id_rol);
    const adminCount = async () => Number((await pool.query("SELECT count(*) FROM usuario u WHERE activo AND cuenta_acceso AND EXISTS (SELECT 1 FROM usuario_rol ur JOIN rol r ON r.id_rol=ur.id_rol WHERE ur.id_usuario=u.id_usuario AND lower(r.nombre)='administracion')")).rows[0].count);
    await t.test('único administrador: DELETE, desactivación, edición de roles y toggle se rechazan y revierten', async () => {
      const before = (await pool.query('SELECT * FROM usuario WHERE id_usuario=1')).rows[0];
      assert.equal(await adminCount(), 1);
      assert.equal((await call(1, 'DELETE', '/usuarios/1')).statusCode, 403);
      assert.equal((await call(1, 'PUT', `/usuarios/1/roles/${adminRole.id_rol}`)).statusCode, 403);
      for (const change of [{ activo: false, roles: [adminRole] }, { activo: true, roles: [perfRole] }]) {
        const res = await call(1, 'PUT', '/usuarios/1', { email: 'admin@test.local', nombre: 'Admin', ...change });
        assert.equal(res.statusCode, 403, res.body);
      }
      assert.deepEqual((await pool.query('SELECT * FROM usuario WHERE id_usuario=1')).rows[0], before);
      assert.equal(await adminCount(), 1);
    });
    await t.test('borrar o renombrar el rol global administración tampoco puede dejar cero admins', async () => {
      assert.equal((await call(1, 'DELETE', `/roles/${adminRole.id_rol}`)).statusCode, 403);
      assert.equal((await call(1, 'PUT', `/roles/${adminRole.id_rol}`, { nombre: 'sin-administracion', descr: 'Cambio de prueba' })).statusCode, 403);
      assert.equal(await adminCount(), 1);
    });
    const crearAdmin = async (email: string) => {
      const response = await call(1, 'POST', '/usuarios', { email, nombre: 'Admin de prueba', password: 'admin-test-password', activo: true, roles: [adminRole] });
      assert.equal(response.statusCode, 201, response.body); return response.json().id_usuario as number;
    };
    await t.test('dos administradores permiten quitar acceso o rol al otro conservando uno', async () => {
      const second = await crearAdmin('second-admin@test.local');
      assert.equal(await adminCount(), 2);
      assert.equal((await call(1, 'PUT', `/usuarios/${second}/roles/${adminRole.id_rol}`)).statusCode, 204);
      assert.equal(await adminCount(), 1);
      assert.equal((await call(1, 'PUT', `/usuarios/${second}/roles/${adminRole.id_rol}`)).statusCode, 204);
      assert.equal(await adminCount(), 2);
      assert.equal((await call(1, 'DELETE', `/usuarios/${second}`)).statusCode, 204);
      assert.equal(await adminCount(), 1);
    });
    await t.test('dos eliminaciones concurrentes de acceso propio no dejan cero administradores', async () => {
      const second = await crearAdmin('race-admin@test.local');
      const responses = await Promise.all([call(1, 'DELETE', '/usuarios/1'), call(second, 'DELETE', `/usuarios/${second}`)]);
      assert.deepEqual(responses.map(r => r.statusCode).sort(), [204, 403]);
      assert.equal(await adminCount(), 1);
    });
    await t.test('dos retiros concurrentes del rol propio tampoco dejan cero administradores', async () => {
      const survivor = Number((await pool.query("SELECT u.id_usuario FROM usuario u JOIN usuario_rol ur USING(id_usuario) JOIN rol r USING(id_rol) WHERE u.activo AND u.cuenta_acceso AND r.nombre='administracion'")).rows[0].id_usuario);
      const created = await call(survivor, 'POST', '/usuarios', { email: 'role-race-admin@test.local', nombre: 'Admin concurrente', password: 'admin-test-password', activo: true, roles: [adminRole] });
      assert.equal(created.statusCode, 201, created.body);
      const second = created.json().id_usuario;
      const responses = await Promise.all([
        call(survivor, 'PUT', `/usuarios/${survivor}/roles/${adminRole.id_rol}`),
        call(second, 'PUT', `/usuarios/${second}/roles/${adminRole.id_rol}`),
      ]);
      assert.deepEqual(responses.map(r => r.statusCode).sort(), [204, 403]);
      assert.equal(await adminCount(), 1);
    });
  } finally {
    await app.close(); await myPool.end(); await pool.end(); await control.end();
    // Conservar esta base aislada y las fotos para inspección; nunca limpiar el piloto.
  }
});
