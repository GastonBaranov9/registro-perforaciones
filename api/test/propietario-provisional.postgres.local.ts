// Ejecutar solo contra una instancia PostgreSQL desechable, sin cargar archivos .env.
// RSP12_TEST_PORT=55432 node --experimental-strip-types --test test/propietario-provisional.postgres.local.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

test('012: migración, provisionales, vinculación, permisos y compatibilidad en PostgreSQL', async t => {
  const port = Number(process.env.RSP12_TEST_PORT);
  assert.ok(Number.isInteger(port) && port >= 1024 && port !== 5432, 'Indique RSP12_TEST_PORT de una instancia desechable (distinto de 5432).');
  const nombreDb = `rsp12_test_${process.pid}_${Date.now()}`;
  const control = new Pool({ host: '127.0.0.1', port, user: 'rsp12_test', database: 'postgres' });
  await control.query(`CREATE DATABASE ${nombreDb}`);
  const pool = new Pool({ host: '127.0.0.1', port, user: 'rsp12_test', database: nombreDb });
  const fotos = await fs.mkdtemp(path.join(os.tmpdir(), 'rsp12-fotos-'));
  Object.assign(process.env, { PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'rsp12_test', PGDATABASE: nombreDb, NODE_ENV: 'test', FOTOS_DIR: fotos, FASTIFY_SECRET: 'rsp12-local-test-secret-never-used-outside-tests' });
  const { myPool } = await import('../src/db/pool.ts');
  const app = Fastify();
  try {
    const migraciones = (await fs.readdir(new URL('../db/migrations/', import.meta.url))).filter(x => x.endsWith('.sql')).sort();
    for (const nombre of migraciones.filter(x => x.slice(0, 3) <= '011')) {
      await pool.query('BEGIN');
      await pool.query(await fs.readFile(new URL('../db/migrations/' + nombre, import.meta.url), 'utf8'));
      await pool.query('COMMIT');
    }
    await pool.query("UPDATE numeracion_perforacion SET proximo=1000");
    await pool.query(`INSERT INTO usuario(id_usuario,email,nombre,password) VALUES
      (1,'admin@test.local','Administración','hash'),(2,'perf@test.local','Perforador','hash'),
      (3,'real@test.local','Marcelo Bellagamba','hash'),(4,'homonimo@test.local','Marcelo Bellagamba','hash'),
      (5,'otroperf@test.local','Otro perforador','hash');
      INSERT INTO usuario_rol SELECT 1,id_rol FROM rol WHERE nombre='administracion';
      INSERT INTO usuario_rol SELECT 2,id_rol FROM rol WHERE nombre='perforador';
      INSERT INTO usuario_rol SELECT 3,id_rol FROM rol WHERE nombre='propietario';
      INSERT INTO usuario_rol SELECT 4,id_rol FROM rol WHERE nombre IN ('propietario','perforador');
      INSERT INTO usuario_rol SELECT 5,id_rol FROM rol WHERE nombre='perforador';
      SELECT setval(pg_get_serial_sequence('usuario','id_usuario'),5);
      INSERT INTO sitio(id_sitio,departamento,localidad,latitud,longitud) VALUES(1,'Salto','Histórico','-31','-57');
      SELECT setval(pg_get_serial_sequence('sitio','id_sitio'),1);
      INSERT INTO pozo(id_propietario,id_perforador,id_sitio,empresa) VALUES(3,2,1,'Histórico');`);
    const antiguo = (await pool.query('SELECT * FROM pozo')).rows[0];
    const usuariosAntes = (await pool.query('SELECT * FROM usuario ORDER BY id_usuario')).rows;
    await t.test('012 conserva usuarios, IDs, FK y números históricos', async () => {
      await pool.query('BEGIN');
      await pool.query(await fs.readFile(new URL('../db/migrations/012_propietario_provisional.sql', import.meta.url), 'utf8'));
      await pool.query(await fs.readFile(new URL('../db/migrations/013_busqueda_personas_admin.sql', import.meta.url), 'utf8'));
      await pool.query('COMMIT');
      assert.deepEqual((await pool.query('SELECT * FROM usuario ORDER BY id_usuario')).rows, usuariosAntes);
      assert.deepEqual((await pool.query('SELECT * FROM pozo')).rows[0], { ...antiguo, propietario_provisional: null });
      await assert.rejects(pool.query('UPDATE pozo SET id_propietario=NULL'), /pozo_propietario_real_o_provisional/);
      await assert.rejects(pool.query("UPDATE pozo SET propietario_provisional='Ambiguo'"), /pozo_propietario_real_o_provisional/);
      await assert.rejects(pool.query('UPDATE pozo SET id_propietario=999999'), /foreign key/);
    });
    await app.register(cookie);
    await app.register((await import('../src/plugins/jwt.ts')).default);
    app.decorate('notifyClient', () => {});
    app.decorate('notifyAdmin', () => {});
    await app.register((await import('../src/routes/pozos.ts')).default);
    await app.register((await import('../src/routes/usuarios.ts')).default);
    await app.ready();
    const { SESSION_COOKIE } = await import('../src/plugins/cookies.ts');
    const sesion = (id: number) => ({ [SESSION_COOKIE]: app.jwt.sign({ sub: id, version_sesion: 1 }, { expiresIn: '1h' }) });
    const request = async (id: number, method: 'POST'|'PUT'|'GET', url: string, payload?: object) => app.inject({ method, url, cookies: sesion(id), ...(payload ? { payload } : {}) });
    const datos = {
      pozo: { id_propietario: null, propietario_provisional: ' Marcelo Bellagamba ', id_perforador: 2, empresa: 'Prueba', profundidad_final_m: 40 },
      sitio_nuevo: { departamento: 'Salto', localidad: 'Lugar', latitud: '-31', longitud: '-57', padron: '012-A' },
      intervalos_litologicos: [{ desde_m: 0, hasta_m: 40, material: 'Histórico' }],
      intervalos_diametro: [{ desde_m: 0, hasta_m: 40, diametro_pulg: 6, material_tuberia: 'PVC' }],
      intervalos_filtro: [{ desde_m: 20, hasta_m: 30, diametro_pulg: 6, material_tuberia: 'PVC', ranura_mm: 0.75 }],
      niveles_aporte: [{ profundidad_m: 25 }],
      foto: { mime_type: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' },
    };
    await t.test('rechaza representación ambigua o vacía y permite seleccionar propietario anterior', async () => {
      for (const pozo of [
        {...datos.pozo,propietario_provisional:'   '},
        {...datos.pozo,id_propietario:0,propietario_provisional:null},
      ]) assert.equal((await request(2,'POST','/usuarios/2/pozos/completo',{...datos,pozo})).statusCode,400);
      assert.equal((await request(2,'POST','/usuarios/2/pozos/completo',{
        ...datos,pozo:{...datos.pozo,id_propietario:3,propietario_provisional:null},
      })).statusCode,403);
      const anterior=await request(1,'POST','/usuarios/2/pozos/completo',{
        ...datos,pozo:{...datos.pozo,id_propietario:3,propietario_provisional:null},
      });
      assert.equal(anterior.statusCode,201,anterior.body);
      assert.equal(anterior.json().pozo.id_propietario,3);
      assert.deepEqual((await pool.query('SELECT * FROM usuario ORDER BY id_usuario')).rows,usuariosAntes);
    });
    let idPozo: number;
    await t.test('perforador guarda provisional, cuatro grupos y foto sin crear usuarios', async () => {
      const respuesta = await request(2, 'POST', '/usuarios/2/pozos/completo', datos);
      assert.equal(respuesta.statusCode, 201, respuesta.body);
      const resultado = respuesta.json(); idPozo = resultado.pozo.id_pozo;
      assert.equal(resultado.pozo.id_propietario, null);
      assert.equal(resultado.pozo.propietario_provisional, 'Marcelo Bellagamba');
      for (const campo of ['intervalos_litologicos','intervalos_diametro','intervalos_filtro','niveles_aporte']) assert.equal(resultado[campo].length, 1);
      assert.deepEqual((await pool.query('SELECT * FROM usuario ORDER BY id_usuario')).rows, usuariosAntes);
      assert.equal((await request(2, 'GET', '/pozos/candidatos-personas?propietario=Marcelo')).statusCode, 403);
      assert.equal((await request(2, 'GET', '/pozos/propietarios/3')).statusCode, 403);
      assert.equal((await request(2, 'POST', '/pozos/propietarios', { nombre: 'Intento directo' })).statusCode, 403);
      assert.equal((await request(2, 'PUT', '/pozos/propietarios/3', { nombre: 'Intento edición' })).statusCode, 403);
    });
    await t.test('dos pozos con el mismo nombre provisional no duplican identidades', async () => {
      const segundo = await request(2, 'POST', '/usuarios/2/pozos/completo', { ...datos, foto: undefined });
      assert.equal(segundo.statusCode, 201, segundo.body);
      assert.notEqual(segundo.json().pozo.id_pozo, idPozo);
      assert.equal(segundo.json().pozo.id_propietario, null);
      assert.deepEqual((await pool.query('SELECT * FROM usuario ORDER BY id_usuario')).rows, usuariosAntes);
    });
    const snapshot = async () => {
      const pozo = (await pool.query('SELECT * FROM pozo WHERE id_pozo=$1', [idPozo])).rows[0];
      const { id_propietario, propietario_provisional, ...conservado } = pozo;
      const hijos = [];
      for (const tabla of ['intervalo_litologico','intervalo_diametro_perforacion','intervalo_filtro','nivel_aporte']) hijos.push((await pool.query(`SELECT * FROM ${tabla} WHERE id_pozo=$1`, [idPozo])).rows);
      return { conservado, hijos, foto: await fs.readFile(path.join(fotos, `pozo-${idPozo}.png`)) };
    };
    const antes = await snapshot();
    await t.test('provisional aparece en detalle, listado y PDF; no da permisos por nombre', async () => {
      const detalle = await request(2, 'GET', `/usuarios/2/pozos/${idPozo}`);
      assert.equal(detalle.statusCode, 200, detalle.body);
      assert.equal(detalle.json().propietario_nombre, 'Marcelo Bellagamba');
      assert.equal(detalle.json().id_propietario, null);
      const listado = await request(2, 'GET', '/usuarios/2/pozos');
      assert.equal(listado.statusCode,200,listado.body);
      assert.ok(listado.json().some((p: {id_pozo:number;id_propietario:unknown}) => p.id_pozo===idPozo && p.id_propietario===null));
      for (const id of [3,4,5]) {
        assert.equal((await request(id, 'GET', `/usuarios/${id}/pozos/${idPozo}`)).statusCode,404);
        assert.equal((await request(id, 'GET', detalle.json().foto_url)).statusCode,404);
      }
      assert.equal((await request(2,'GET',detalle.json().foto_url)).statusCode,200);
      const { getReportePozo } = await import('../src/services/generar-informe-consultas.ts');
      const reporte = await getReportePozo(idPozo, pool);
      assert.match(reporte!.propietario, /Marcelo Bellagamba.*pendiente/);
    });
    await t.test('buscador devuelve una vez cada ID y conserva homónimos con múltiples roles', async () => {
      const respuesta = await request(1,'GET','/pozos/candidatos-personas?propietario=Marcelo');
      assert.equal(respuesta.statusCode,200,respuesta.body);
      assert.deepEqual(respuesta.json().propietarios.map((p:{id_usuario:number})=>p.id_usuario),[3,4]);
    });
    await t.test('solo administración vincula y conserva íntegros hijos, foto y numeración', async () => {
      const payload={id_propietario:3,id_propietario_esperado:null};
      assert.equal((await request(2,'PUT',`/pozos/${idPozo}/propietario`,payload)).statusCode,403);
      assert.equal((await request(3,'PUT',`/pozos/${idPozo}/propietario`,payload)).statusCode,403);
      assert.equal((await request(1,'PUT',`/pozos/${idPozo}/propietario`,{...payload,id_propietario:5})).statusCode,400);
      assert.deepEqual(await snapshot(),antes);
      const vinculacion=await request(1,'PUT',`/pozos/${idPozo}/propietario`,payload);
      assert.equal(vinculacion.statusCode,200,vinculacion.body);
      assert.deepEqual(await snapshot(),antes);
      assert.equal((await request(3,'GET',`/usuarios/3/pozos/${idPozo}`)).statusCode,200);
      assert.equal((await request(4,'GET',`/usuarios/4/pozos/${idPozo}`)).statusCode,404);
      assert.equal((await request(3,'GET',antes.conservado.foto_url)).statusCode,200);
      assert.equal((await request(1,'PUT',`/pozos/${idPozo}/propietario`,payload)).statusCode,400);
      const {foto,...tecnicos}=datos;
      const stale=await request(2,'PUT',`/usuarios/2/pozos/${idPozo}/completo`,{...tecnicos,pozo:{...datos.pozo,id_sitio:antes.conservado.id_sitio},foto_accion:'conservar'});
      assert.equal(stale.statusCode,400,stale.body);
      const legacy=await request(2,'PUT',`/usuarios/2/pozos/${idPozo}`,{...datos.pozo,id_propietario:4,propietario_provisional:null,id_sitio:antes.conservado.id_sitio});
      assert.notEqual(legacy.statusCode,200);
      assert.deepEqual(await snapshot(),antes);
    });
    await t.test('administración puede crear identidad real y vincularla sin credenciales automáticas',async()=>{
      const alta=await request(1,'POST','/pozos/propietarios',{nombre:'Identidad Pérez',documento_rut:'PRUEBA-012'});
      assert.equal(alta.statusCode,201,alta.body);
      const id=alta.json().id_usuario;
      const usuario=(await pool.query('SELECT * FROM usuario WHERE id_usuario=$1',[id])).rows[0];
      assert.equal(usuario.cuenta_acceso,false);assert.equal(usuario.password,null);assert.equal(usuario.email,null);
      const vinculo=await request(1,'PUT',`/pozos/${idPozo}/propietario`,{id_propietario:id,id_propietario_esperado:3});
      assert.equal(vinculo.statusCode,200,vinculo.body);assert.deepEqual(await snapshot(),antes);
      const personas=await request(1,'GET','/usuarios/personas?buscar=identidad%20perez');
      assert.equal(personas.statusCode,200,personas.body);
      assert.equal(personas.json().personas.find((p:{id_usuario:number})=>p.id_usuario===id).cuenta_acceso,false);
      assert.equal((await request(1,'GET','/usuarios/personas?buscar=prueba-012')).json().total,1);
      assert.equal((await request(1,'GET',`/usuarios/personas?buscar=${id}`)).json().personas.some((p:{id_usuario:number})=>p.id_usuario===id),true);
      assert.equal((await request(2,'GET','/usuarios/personas?buscar=Identidad')).statusCode,403);
      const asociadas=await request(1,'GET',`/usuarios/personas/${id}/perforaciones`);
      assert.equal(asociadas.statusCode,200,asociadas.body);
      assert.equal(asociadas.json().total,1);
      assert.equal(asociadas.json().perforaciones[0].id_pozo,idPozo);
      assert.equal(asociadas.json().perforaciones[0].numero_perforacion,antes.conservado.numero_perforacion);
      assert.equal((await request(2,'GET',`/usuarios/personas/${id}/perforaciones`)).statusCode,403);
    });
  } finally {
    await app.close(); await myPool.end(); await pool.end();
    // Solo elimina la base de nombre generado por esta prueba, jamás una proporcionada por el entorno.
    await control.query(`DROP DATABASE ${nombreDb}`); await control.end();
    await fs.rm(fotos, { recursive: true, force: true });
  }
});
