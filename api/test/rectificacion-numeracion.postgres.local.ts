// Clúster NUEVO en Temp, puerto loopback aleatorio, datos ficticios. Nunca lee .env.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import Fastify from 'fastify';
import { ejecutarMigraciones } from '../src/db/migrator.ts';

process.env.NODE_ENV = 'test';
for (const key of Object.keys(process.env)) if (/^(PG|POSTGRES_)/i.test(key)) delete process.env[key];
const { rectificarNumeracion, previsualizarRectificacion } = await import('../src/services/rectificacion-numeracion-service.ts');
const { myPool } = await import('../src/db/pool.ts');
const { default: routes } = await import('../src/routes/numeracion-perforacion.ts');
const { T05SinPermiso } = await import('../src/models/errors.ts');
const bin = process.argv[2] ?? 'C:/Program Files/PostgreSQL/18/bin';
const root = mkdtempSync(path.join(tmpdir(), 'rsp-rectificacion-pg-'));
const data = path.join(root, 'data');
const password = randomBytes(24).toString('hex');
const passwordFile = path.join(root, 'password');
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const address = listener.address(); assert.ok(address && typeof address === 'object');
const port = address.port;
await new Promise<void>((resolve, reject) => listener.close(e => e ? reject(e) : resolve()));
function pg(command: string, args: string[]) {
  return execFileSync(path.join(bin, command + (process.platform === 'win32' ? '.exe' : '')), args,
    { env: { ...process.env, PGPASSWORD: password }, encoding: 'utf8', windowsHide: true, timeout: 60000,
      stdio: command === 'pg_ctl' ? 'ignore' : ['pipe','pipe','pipe'] });
}
let started = false;
let pool: Pool | undefined;
let passed = 0;
async function check(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log('PASS ' + name); }
try {
  writeFileSync(passwordFile, password);
  pg('initdb', ['-D',data,'-U','postgres','--auth=scram-sha-256','--pwfile='+passwordFile,'--encoding=UTF8','--locale=C']);
  unlinkSync(passwordFile);
  started = true;
  pg('pg_ctl', ['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=15`,'-w','start']);
  pool = new Pool({ host:'127.0.0.1', port, user:'postgres', password, database:'postgres', ssl:false, options:'', max:6 });
  assert.equal(path.resolve((await pool.query('SHOW data_directory')).rows[0].data_directory).toLowerCase(),path.resolve(data).toLowerCase());
  console.log('Aislamiento: clúster propio verificado; sin Docker, producción ni datos reales.');
  await ejecutarMigraciones(pool, { logger: () => {} });
  await pool.query(`INSERT INTO usuario(id_usuario,nombre,email,password,cuenta_acceso) VALUES
    (1,'Admin','admin@example.test','no-login',TRUE),(2,'Perforador','p@example.test','no-login',TRUE),(3,'Operador','o@example.test','no-login',TRUE),(4,'Propietario',NULL,NULL,FALSE);
    INSERT INTO usuario_rol SELECT 1,id_rol FROM rol WHERE nombre='administracion';
    INSERT INTO usuario_rol SELECT 2,id_rol FROM rol WHERE nombre='perforador';
    INSERT INTO usuario_rol SELECT 3,id_rol FROM rol WHERE nombre='operador_administrativo';
    INSERT INTO sitio(departamento) VALUES ('Salto');
    INSERT INTO pozo(origen,numero_perforacion,creado_por) VALUES ('historico',3277,1),('historico',3281,1);
    UPDATE numeracion_perforacion SET proximo=3282;
    INSERT INTO pozo(id_propietario,id_perforador,id_sitio) VALUES (4,2,1),(4,2,1);
    DELETE FROM pozo WHERE numero_perforacion>=3282;`);
  const stable = (await pool.query('SELECT json_agg(p ORDER BY id_pozo) AS datos FROM pozo p')).rows[0].datos;
  const sequence = (await pool.query('SELECT last_value FROM pozo_id_pozo_seq')).rows[0].last_value;
  const snapshot = async () => (await pool!.query(`SELECT json_build_object('contador',(SELECT row_to_json(n) FROM numeracion_perforacion n),
    'reservas',(SELECT json_agg(r ORDER BY numero_perforacion) FROM numero_perforacion_reservado r),
    'auditoria',(SELECT json_agg(a ORDER BY id) FROM numeracion_rectificacion a),
    'configuracion',(SELECT json_agg(c ORDER BY id) FROM numeracion_perforacion_configuracion c)) AS estado`)).rows[0].estado;
  const vista = await previsualizarRectificacion(1,3282,pool);
  const solicitud = { desde:3282, esperado:3284, mayor_esperado:3283, reservas:vista.reservas.map(({bloqueada,...r}) => r), motivo:'Anulación de pruebas ficticias eliminadas', sin_referencias_externas:true };
  const rejected = async (fn: () => Promise<unknown>, status: number) => {
    const before = await snapshot();
    await assert.rejects(fn, (e: any) => e.statusCode===status);
    assert.deepEqual(await snapshot(),before);
  };
  await check('eliminar no libera números; vista previa conserva identidad original',async () => {
    assert.equal(vista.proximo,3284); assert.equal(vista.mayor_asignado,3283);
    assert.deepEqual(vista.reservas.map(r => [r.numero_perforacion,r.bloqueada]),[[3282,false],[3283,false]]);
  });
  await check('perforador, operador y cuenta deshabilitada rechazados sin cambios',async () => {
    for (const actor of [2,3]) await rejected(() => rectificarNumeracion(actor,solicitud,pool!),403);
    await pool!.query('UPDATE usuario SET activo=FALSE WHERE id_usuario=1');
    await rejected(() => rectificarNumeracion(1,solicitud,pool!),403);
    await pool!.query('UPDATE usuario SET activo=TRUE WHERE id_usuario=1');
  });
  await check('motivo y declaración obligatorios; rango histórico protegido',async () => {
    for (const cambio of [{motivo:'  '},{sin_referencias_externas:false},{desde:3281}])
      await rejected(() => rectificarNumeracion(1,{...solicitud,...cambio},pool!),400);
  });
  await check('estado obsoleto, reservas incompletas e identidad incorrecta rechazados',async () => {
    for (const cambio of [{esperado:3285},{reservas:solicitud.reservas.slice(0,1)},
      {reservas:solicitud.reservas.map(r => ({...r,id_pozo_original:'99999'}))}])
      await rejected(() => rectificarNumeracion(1,{...solicitud,...cambio},pool!),409);
  });
  await check('referencia idempotente offline bloquea incluso con pozo eliminado',async () => {
    await pool!.query(`INSERT INTO creacion_offline(actor,clave,huella,resultado,epoca) VALUES
      (1,gen_random_uuid(),repeat('a',64),$1::jsonb,(SELECT epoca FROM epoca_datos))`,[JSON.stringify({pozo:{id_pozo:Number(solicitud.reservas[0].id_pozo_original),numero_perforacion:3282}})]);
    await rejected(() => rectificarNumeracion(1,solicitud,pool!),409);
    await pool!.query('DELETE FROM creacion_offline');
  });
  await check('rollback íntegro si falla auditoría',async () => {
    await pool!.query(`CREATE FUNCTION fallar_auditoria_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulado'; END $$;
      CREATE TRIGGER fallo_test BEFORE INSERT ON numeracion_rectificacion FOR EACH ROW EXECUTE FUNCTION fallar_auditoria_test();`);
    const before = await snapshot();
    await assert.rejects(rectificarNumeracion(1,solicitud,pool!),/simulado/);
    assert.deepEqual(await snapshot(),before);
    await pool!.query('DROP TRIGGER fallo_test ON numeracion_rectificacion');
  });
  await check('rollback íntegro después de liberar reservas si falla persistencia del contador',async () => {
    await pool!.query('CREATE TRIGGER fallo_test BEFORE UPDATE ON numeracion_perforacion FOR EACH ROW EXECUTE FUNCTION fallar_auditoria_test()');
    const before = await snapshot();
    await assert.rejects(rectificarNumeracion(1,solicitud,pool!),/simulado/);
    assert.deepEqual(await snapshot(),before);
    await pool!.query('DROP TRIGGER fallo_test ON numeracion_perforacion');
  });
  await check('dos rectificaciones concurrentes: sólo una confirma; auditoría completa y registros intactos',async () => {
    const outcomes = await Promise.allSettled([rectificarNumeracion(1,solicitud,pool!),rectificarNumeracion(1,solicitud,pool!)]);
    assert.equal(outcomes.filter(o => o.status==='fulfilled').length,1);
    const failed = outcomes.find(o => o.status==='rejected') as PromiseRejectedResult;
    assert.equal(failed.reason.statusCode,409);
    const audit = (await pool!.query('SELECT * FROM numeracion_rectificacion')).rows;
    assert.equal(audit.length,1); assert.equal(audit[0].actor,'1'); assert.ok(audit[0].creado_en);
    assert.equal(audit[0].motivo,solicitud.motivo); assert.equal(audit[0].proximo_anterior,'3284'); assert.equal(audit[0].proximo_nuevo,'3282');
    assert.deepEqual(audit[0].reservas_anuladas,vista.reservas);
    assert.deepEqual((await pool!.query('SELECT json_agg(p ORDER BY id_pozo) AS datos FROM pozo p')).rows[0].datos,stable);
    assert.equal((await pool!.query('SELECT last_value FROM pozo_id_pozo_seq')).rows[0].last_value,sequence);
    for (const sql of ['DELETE FROM numeracion_rectificacion','UPDATE numeracion_rectificacion SET motivo=motivo','TRUNCATE numeracion_rectificacion']) await assert.rejects(pool!.query(sql),/inmutable/);
  });
  await check('reutilización explícita crea identidad nueva; eliminación normal conserva nueva reserva',async () => {
    const created = (await pool!.query('INSERT INTO pozo(id_propietario,id_perforador,id_sitio) VALUES (4,2,1) RETURNING id_pozo,numero_perforacion')).rows[0];
    assert.equal(created.numero_perforacion,3282);
    assert.notEqual(String(created.id_pozo),solicitud.reservas[0].id_pozo_original);
    const v = await previsualizarRectificacion(1,3282,pool!);
    assert.equal(v.reservas[0].bloqueada,true);
    await rejected(() => rectificarNumeracion(1,{...solicitud,esperado:v.proximo!,mayor_esperado:v.mayor_asignado,reservas:v.reservas},pool!),409);
    await pool!.query('DELETE FROM pozo WHERE id_pozo=$1',[created.id_pozo]);
    assert.equal((await pool!.query('SELECT count(*) FROM numero_perforacion_reservado WHERE numero_perforacion=3282')).rows[0].count,'1');
  });
  await check('asignación concurrente bloquea y vuelve obsoleta la rectificación',async () => {
    const v = await previsualizarRectificacion(1,3282,pool!);
    const writer = await pool!.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('SELECT singleton FROM numeracion_perforacion FOR UPDATE');
      let finished=false;
      const pending=rectificarNumeracion(1,{...solicitud,esperado:v.proximo!,mayor_esperado:v.mayor_asignado,reservas:v.reservas},pool!).then(() => {finished=true; return null;},e => {finished=true; return e;});
      await new Promise(resolve => setTimeout(resolve,100)); assert.equal(finished,false);
      await writer.query('INSERT INTO pozo(id_propietario,id_perforador,id_sitio) VALUES (4,2,1)');
      await writer.query('COMMIT');
      assert.equal((await pending).statusCode,409);
    } finally { await writer.query('ROLLBACK'); writer.release(); }
    assert.equal((await pool!.query('SELECT count(*) FROM numeracion_rectificacion')).rows[0].count,'1');
  });
  await check('HTTP: rutas administrativas y rechazo de payload inválido',async () => {
    const oldQuery=myPool.query, oldConnect=myPool.connect;
    myPool.query=pool!.query.bind(pool); myPool.connect=pool!.connect.bind(pool);
    const app=Fastify();
    app.decorate('authenticate',async req => { req.user={sub:Number(req.headers['x-test-user']??2)} as typeof req.user; });
    app.decorate('userIsAdmin',async req => { if(Number(req.user.sub)!==1) throw new T05SinPermiso(); });
    try {
      await app.register(routes);
      for(const id of [2,3]) {
        assert.equal((await app.inject({method:'GET',url:'/pozos/numeracion/rectificacion/3282',headers:{'x-test-user':String(id)}})).statusCode,403);
        assert.equal((await app.inject({method:'POST',url:'/pozos/numeracion/rectificacion',payload:solicitud,headers:{'x-test-user':String(id)}})).statusCode,403);
      }
      assert.equal((await app.inject({method:'POST',url:'/pozos/numeracion/rectificacion',payload:{...solicitud,sin_referencias_externas:false},headers:{'x-test-user':'1'}})).statusCode,400);
      assert.equal((await app.inject({method:'GET',url:'/pozos/numeracion/rectificacion/3282',headers:{'x-test-user':'1'}})).statusCode,200);
    } finally { await app.close(); myPool.query=oldQuery; myPool.connect=oldConnect; }
  });
  console.log(`${passed}/${passed} comprobaciones PostgreSQL aprobadas. Datos ficticios conservados en ${root}`);
} finally {
  await pool?.end(); await myPool.end();
  if(started) pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);
}
