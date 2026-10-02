// Isolated PostgreSQL only; never reads .env. Each run creates/drops its own DB.
// RSP_SESSION_TEST_PORT=55439 node --experimental-strip-types --test test/escritura-sesion.postgres.local.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

test('session writes: PostgreSQL real, HTTP web/Android, locks, rollback and 37 operations', { timeout: 120_000 }, async t => {
  const port = Number(process.env.RSP_SESSION_TEST_PORT);
  assert.ok(Number.isInteger(port) && port >= 1024 && port !== 5432, 'Require explicit disposable PostgreSQL port, never 5432');
  const database = `rsp_session_test_${process.pid}_${Date.now()}`;
  const config = { host: '127.0.0.1', port, user: 'rsp12_test' };
  const control = new Pool({ ...config, database: 'postgres' });
  await control.query(`CREATE DATABASE ${database}`);
  const db = new Pool({ ...config, database });
  const fotos = await fs.mkdtemp(path.join(os.tmpdir(), 'rsp-session-fotos-'));
  Object.assign(process.env, { PGHOST: config.host, PGPORT: String(port), PGUSER: config.user, PGDATABASE: database,
    NODE_ENV: 'test', FOTOS_DIR: fotos, FASTIFY_SECRET: 'isolated-session-test-never-production' });
  const { myPool } = await import('../src/db/pool.ts');
  const { hashPassword } = await import('../src/services/password-service.ts');
  const { crearSesionNative } = await import('../src/services/native-auth-service.ts');
  const { contextoEscritura, conEscrituraSesion } = await import('../src/services/escritura-sesion.ts');
  const { SESSION_COOKIE } = await import('../src/plugins/cookies.ts');
  const app = Fastify();
  const held = await db.connect();
  let pause: { url: string; reached: ReturnType<typeof deferred>; resume: ReturnType<typeof deferred> } | undefined;
  const recorded: string[] = [];
  try {
    for (const file of (await fs.readdir(new URL('../db/migrations/', import.meta.url))).filter(x => x.endsWith('.sql')).sort()) {
      await db.query(await fs.readFile(new URL('../db/migrations/' + file, import.meta.url), 'utf8'));
    }
    const password = 'IsolatedSecurity123!';
    const hash = await hashPassword(password);
    for (const [id, name] of [[1, 'Admin'], [2, 'Perforador'], [3, 'Auditor'], [4, 'Propietario']] as const)
      await db.query('INSERT INTO usuario(id_usuario,email,nombre,password) VALUES($1,$2,$3,$4)', [id, `u${id}@test.invalid`, name, hash]);
    await db.query(`INSERT INTO usuario_rol SELECT 1,id_rol FROM rol WHERE nombre='administracion';
      INSERT INTO usuario_rol SELECT 2,id_rol FROM rol WHERE nombre='perforador';
      INSERT INTO usuario_rol SELECT 3,id_rol FROM rol WHERE nombre='administracion';
      INSERT INTO usuario_rol SELECT 4,id_rol FROM rol WHERE nombre='propietario';
      SELECT setval(pg_get_serial_sequence('usuario','id_usuario'),4);
      INSERT INTO sitio(id_sitio,departamento,latitud,longitud) VALUES(1,'Salto','-31','-57'),(2,'Salto','-31','-57');
      SELECT setval(pg_get_serial_sequence('sitio','id_sitio'),2);
      UPDATE numeracion_perforacion SET proximo=1000;
      INSERT INTO pozo(id_pozo,id_propietario,id_perforador,id_sitio,creado_por,profundidad_final_m,foto_url)
        VALUES(1,4,2,1,2,40,'pozo-1.png');
      SELECT setval(pg_get_serial_sequence('pozo','id_pozo'),1);
      INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material) VALUES(1,0,10,'Legado');
      INSERT INTO intervalo_diametro_perforacion(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES(1,0,10,6,'PVC');
      INSERT INTO intervalo_filtro(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,ranura_mm) VALUES(1,20,30,6,'PVC',0.75);
      INSERT INTO nivel_aporte(id_pozo,profundidad_m) VALUES(1,25);`);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    await fs.writeFile(path.join(fotos, 'pozo-1.png'), png);
    const roles = (await db.query('SELECT * FROM rol ORDER BY id_rol')).rows;
    const adminRole = roles.find(r => r.nombre === 'administracion');
    const perfRole = roles.find(r => r.nombre === 'perforador');
    await app.register((await import('../src/plugins/cookies.ts')).default);
    await app.register((await import('../src/plugins/jwt.ts')).default);
    await app.register(multipart);
    for (const name of ['notifyClient','notifyAdmin','rateLimitLogin','rateLimitUpload','rateLimitNativeLogin','rateLimitNativeWsTicket']) app.decorate(name, async () => {});
    app.addHook('preValidation', async req => {
      if (pause && req.url === pause.url && req.method !== 'GET') { pause.reached.resolve(); await pause.resume.promise; }
    });
    app.addHook('onRoute', route => { if (['POST','PUT','PATCH','DELETE'].includes(String(route.method))) recorded.push(`${route.method} ${route.url}`); });
    for (const file of ['usuarios','roles','pozos','sitios','intervalos-litologicos','intervalos-diametro-perforaciones','intervalos-filtro','niveles-aporte','litologias','numeracion-perforacion','informes','native-auth'])
      await app.register((await import(`../src/routes/${file}.ts`)).default);
    await app.ready();
    const credentials = async (id: number, mechanism = 'web') => {
      if (mechanism === 'android') {
        const issued = await crearSesionNative({ email: `u${id}@test.invalid`, password, installationId: '12345678-1234-4234-8234-123456789abc', platform: 'android', appBuild: 1 });
        return { headers: { authorization: `Bearer ${issued.token}`, 'x-native-platform': 'android', 'x-native-app-build': '1' } };
      }
      const version = Number((await db.query('SELECT version_sesion FROM usuario WHERE id_usuario=$1', [id])).rows[0].version_sesion);
      return { cookies: { [SESSION_COOKIE]: app.jwt.sign({ sub: id, version_sesion: version }, { expiresIn: '1h' }) } };
    };
    const admin = await credentials(1);
    const setActive = async (id: number, activo: boolean) => {
      const r = await app.inject({ method: 'PUT', url: `/usuarios/${id}`, ...admin,
        payload: { email: `u${id}@test.invalid`, nombre: id === 2 ? 'Perforador' : 'Auditor', activo, roles: [id === 2 ? perfRole : adminRole] } });
      assert.equal(r.statusCode, 200, r.body);
    };
    const p = '/usuarios/2/pozos/1';
    const put = (auth: object, empresa = 'Escritura') => app.inject({ method: 'PUT', url: p, ...auth, payload: { id_propietario: 4, id_perforador: 2, id_sitio: 1, empresa } }).then(r => r);
    const waitBlocked = async (fragment: string) => {
      for (let i = 0; i < 500; i++) {
        const r = await db.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND query LIKE $1 AND cardinality(pg_blocking_pids(pid))>0", [`%${fragment}%`]);
        if (r.rowCount) return;
        await delay(10);
      }
      assert.fail(`No lock wait observed for ${fragment}`);
    };
    // Test-only triggers create deterministic barriers *inside* real transactions.
    await db.query(`CREATE FUNCTION test_write_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.empresa='hold-write' THEN PERFORM pg_advisory_xact_lock(91827,1); END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_write_barrier BEFORE UPDATE ON pozo FOR EACH ROW EXECUTE FUNCTION test_write_barrier();
      CREATE FUNCTION test_deactivation_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF OLD.activo AND NOT NEW.activo THEN PERFORM pg_advisory_xact_lock(91827,2); END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_deactivation_barrier BEFORE UPDATE ON usuario FOR EACH ROW EXECUTE FUNCTION test_deactivation_barrier();`);
    for (const mechanism of ['web', 'android']) {
      await t.test(`${mechanism}: authenticated request resumes after deactivation COMMIT => 401; reactivation does not revive`, async () => {
        await setActive(2, true); const old = await credentials(2, mechanism);
        pause = { url: p, reached: deferred(), resume: deferred() };
        const pending = put(old, 'must-not-save'); await pause.reached.promise;
        await setActive(2, false); pause.resume.resolve(); pause = undefined;
        assert.equal((await pending).statusCode, 401);
        assert.notEqual((await db.query('SELECT empresa FROM pozo WHERE id_pozo=1')).rows[0].empresa, 'must-not-save');
        await setActive(2, true);
        assert.equal((await put(old)).statusCode, 401);
        assert.equal((await app.inject({ method: 'GET', url: p, ...old })).statusCode, 401);
      });
      await t.test(`${mechanism}: write locks first, deactivation waits for write COMMIT`, async () => {
        await setActive(2, true); const old = await credentials(2, mechanism);
        await held.query('SELECT pg_advisory_lock(91827,1)');
        const pending = put(old, 'hold-write');
        try {
          await waitBlocked('UPDATE public.pozo');
          const deactivation = setActive(2, false);
          await waitBlocked('pg_advisory_xact_lock(731024, 1)');
          assert.equal((await db.query('SELECT activo FROM usuario WHERE id_usuario=2')).rows[0].activo, true);
          await held.query('SELECT pg_advisory_unlock(91827,1)');
          assert.equal((await pending).statusCode, 200); await deactivation;
          assert.equal((await db.query('SELECT empresa FROM pozo WHERE id_pozo=1')).rows[0].empresa, 'hold-write');
          assert.equal((await put(old, 'late')).statusCode, 401);
        } finally { await held.query('SELECT pg_advisory_unlock_all()'); }
      });
      await t.test(`${mechanism}: deactivation locks first; already authenticated write waits then rejects`, async () => {
        await setActive(2, true); const old = await credentials(2, mechanism);
        pause = { url: p, reached: deferred(), resume: deferred() };
        const pending = put(old, 'late'); await pause.reached.promise;
        await held.query('SELECT pg_advisory_lock(91827,2)');
        try {
          const deactivation = setActive(2, false);
          await waitBlocked('UPDATE usuario');
          pause.resume.resolve(); pause = undefined;
          await waitBlocked('pg_advisory_xact_lock_shared');
          await held.query('SELECT pg_advisory_unlock(91827,2)');
          await deactivation; assert.equal((await pending).statusCode, 401);
        } finally { await held.query('SELECT pg_advisory_unlock_all()'); }
      });
    }
    await setActive(2, true);
    const sitio = { departamento: 'Salto', latitud: '-31', longitud: '-57' };
    const pozo = { id_propietario: 4, id_perforador: 2, profundidad_final_m: 40 };
    const grupos = { intervalos_litologicos: [], intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [] };
    const completo = { pozo, sitio_nuevo: sitio, ...grupos };
    const catalogo = (await db.query('SELECT familia,patron FROM catalogo_litologia LIMIT 1')).rows[0];
    const litologia = { ...catalogo, nombre: 'Prueba', color: '#AABBCC', orden: 1 };
    const cuenta = { email: 'nuevo@test.invalid', nombre: 'Nuevo', password, activo: true, roles: [perfRole] };
    const cases: Array<[string, string, any?]> = [
      ['PUT', p, { ...pozo, id_sitio: 1 }], ['PUT', p+'/completo', { pozo: {...pozo,id_sitio:1}, ...grupos, foto_accion: 'conservar' }], ['DELETE', p],
      ['POST', p+'/foto', 'multipart'], ['DELETE', p+'/foto'],
      ['POST','/usuarios/2/pozos/completo', completo],
      ['POST','/usuarios/2/sitios',sitio], ['PUT','/usuarios/2/sitios/1',sitio], ['DELETE','/usuarios/2/sitios/2'],
      ['POST','/pozos/propietarios',{nombre:'Nuevo propietario'}], ['PUT','/pozos/propietarios/4',{nombre:'Cambio'}],
      ['PUT','/pozos/1/propietario',{id_propietario:4,id_propietario_esperado:4}],
      ['PUT','/pozos/numeracion',{proximo:2000,esperado:1001}], ['PATCH','/pozos/1/numero-perforacion',{numero_perforacion:2001}],
      ['POST','/litologias',{...litologia,codigo:'prueba'}], ['PUT','/litologias/1',litologia],
      ['PATCH','/litologias/1/activar'], ['PATCH','/litologias/1/desactivar'],
      ['POST','/usuarios',cuenta], ['PUT','/usuarios/4',cuenta], ['DELETE','/usuarios/4'], ['PUT',`/usuarios/4/roles/${perfRole.id_rol}`],
      ['POST','/roles',{nombre:'Prueba',descr:'Prueba'}], ['PUT',`/roles/${perfRole.id_rol}`,{nombre:'Prueba',descr:'Prueba'}], ['DELETE',`/roles/${perfRole.id_rol}`],
    ];
    for (const [resource, data] of [
      ['intervalo_litologico',{desde_m:0,hasta_m:10,material:'Legado'}],
      ['intervalo_diametro_perforacion',{desde_m:0,hasta_m:10,diametro_pulg:6,material_tuberia:'PVC'}],
      ['intervalos_filtro',{desde_m:20,hasta_m:30,diametro_pulg:6,material_tuberia:'PVC',ranura_mm:0.75}],
      ['niveles_aporte',{profundidad_m:25}],
    ] as const) cases.push(['POST',`${p}/${resource}`,data],['PUT',`${p}/${resource}/1`,data],['DELETE',`${p}/${resource}/1`]);
    assert.equal(cases.length,37);
    const snapshot = async () => {
      const state: Record<string,unknown> = {};
      for (const table of ['pozo','sitio','intervalo_litologico','intervalo_diametro_perforacion','intervalo_filtro','nivel_aporte','catalogo_litologia','numeracion_perforacion','numero_perforacion_reservado','rol','usuario_rol'])
        state[table] = (await db.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
      state.fotos = await fs.readdir(fotos, {recursive:true});
      state.png = (await fs.readFile(path.join(fotos,'pozo-1.png'))).toString('base64');
      state.usuarios = (await db.query('SELECT * FROM usuario WHERE id_usuario<>3 ORDER BY 1')).rows;
      return state;
    };
    for (const mechanism of ['web','android']) for (const [method,url,payload] of cases) await t.test(`old authenticated administrator (${mechanism}): ${method} ${url} => 401 without side effects`, async () => {
      await setActive(3,true); const old = await credentials(3,mechanism);
      const before = await snapshot();
      pause = {url,reached:deferred(),resume:deferred()};
      let body: any = payload ? {payload} : {};
      if(payload==='multipart') body={headers:{'content-type':'multipart/form-data; boundary=rsp-test'},payload:Buffer.concat([Buffer.from('--rsp-test\r\nContent-Disposition: form-data; name="file"; filename="foto.png"\r\nContent-Type: image/png\r\n\r\n'),png,Buffer.from('\r\n--rsp-test--\r\n')])};
      const pending = app.inject({method:method as any,url,...old,...body,headers:{...old.headers,...body.headers}}).then(r=>r);
      await pause.reached.promise; await setActive(3,false); pause.resume.resolve(); pause=undefined;
      const r=await pending; assert.equal(r.statusCode,401,r.body);
      assert.deepEqual(await snapshot(),before);
    });
    await t.test('photo replacement SQL failure restores bytes and removes temporary files before rollback completes', async () => {
      const { reemplazarFotoPersistida } = await import('../src/services/foto-pozo-service.ts');
      await setActive(2,true);
      const version=Number((await db.query('SELECT version_sesion FROM usuario WHERE id_usuario=2')).rows[0].version_sesion);
      const before=(await db.query('SELECT foto_url FROM pozo WHERE id_pozo=1')).rows[0];
      await assert.rejects(contextoEscritura.run({idUsuario:2,versionSesion:version,idPozo:1},()=>
        reemplazarFotoPersistida(1,fotos,{buffer:Buffer.from([0xff,0xd8,0xff,0]),extension:'jpg'},'pozo-1.jpg',async client=>{
          await client.query("UPDATE pozo SET foto_url='pozo-1.jpg' WHERE id_pozo=1");
          await client.query('SELECT 1/0');
        })),/division by zero/);
      assert.deepEqual((await db.query('SELECT foto_url FROM pozo WHERE id_pozo=1')).rows[0],before);
      assert.deepEqual(await fs.readFile(path.join(fotos,'pozo-1.png')),png);
      assert.deepEqual((await fs.readdir(fotos,{recursive:true})).filter(x=>x!=='.trash'),['pozo-1.png']);
      await setActive(2,false);
    });
    await t.test('administrators can edit each other concurrently without actor/target deadlock', async () => {
      await setActive(3,true);
      const other=await credentials(3);
      const results=await Promise.all([
        app.inject({method:'PUT',url:'/usuarios/3',...admin,payload:{email:'u3@test.invalid',nombre:'Auditor',activo:true,roles:[adminRole]}}),
        app.inject({method:'PUT',url:'/usuarios/1',...other,payload:{email:'u1@test.invalid',nombre:'Admin',activo:true,roles:[adminRole]}}),
      ]);
      for(const r of results) assert.equal(r.statusCode,200,r.body);
    });
    await t.test('failed SQL rolls back and releases locks; next authorized write and deactivation succeed', async () => {
      await setActive(2,true);
      const version=Number((await db.query('SELECT version_sesion FROM usuario WHERE id_usuario=2')).rows[0].version_sesion);
      await assert.rejects(contextoEscritura.run({idUsuario:2,versionSesion:version},()=>conEscrituraSesion(async client=>{
        await client.query("UPDATE pozo SET empresa='rollback-only' WHERE id_pozo=1");
        await client.query('SELECT 1/0');
      },myPool)), /division by zero/);
      assert.notEqual((await db.query('SELECT empresa FROM pozo WHERE id_pozo=1')).rows[0].empresa,'rollback-only');
      assert.equal((await put(await credentials(2))).statusCode,200);
      await setActive(2,false);
    });
    await t.test('24h: own current succeeds, old/foreign/delete fail; administration edits old well', async () => {
      await setActive(2,true); const auth=await credentials(2);
      assert.equal((await put(auth)).statusCode,200);
      await db.query("UPDATE pozo SET fecha_creado=now()-interval '25 hours' WHERE id_pozo=1");
      assert.equal((await put(auth)).statusCode,403);
      assert.equal((await app.inject({method:'PUT',url:p+'/niveles_aporte/1',...auth,payload:{profundidad_m:26}})).statusCode,403);
      assert.equal((await put(admin)).statusCode,200);
      await db.query('UPDATE pozo SET fecha_creado=now(),creado_por=1 WHERE id_pozo=1');
      assert.equal((await put(auth)).statusCode,403);
      assert.equal((await app.inject({method:'DELETE',url:p,...auth})).statusCode,403);
    });
    const inventory=recorded.filter(r=>!r.includes('/auth/')&&!r.includes('/perfil-litologico/vista-previa')&&r!=='POST /usuarios/:id_usuario/pozos');
    assert.equal(inventory.length,37,'all registered domain/admin mutations accounted for');
  } finally {
    pause?.resume.resolve();
    await held.query('SELECT pg_advisory_unlock_all()'); held.release();
    await app.close(); await myPool.end(); await db.end();
    await control.query(`DROP DATABASE ${database} WITH (FORCE)`); await control.end();
    await fs.rm(fotos,{recursive:true,force:true});
  }
});
