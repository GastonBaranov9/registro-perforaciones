// Nunca carga .env. Sólo usuario y puerto explícitos del laboratorio desechable.
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

test('carga historica en PostgreSQL aislada', async t=>{
  const port=Number(process.env.RSP_RESET_TEST_PORT);
  assert.ok(Number.isInteger(port)&&port>1024&&port!==5432,'Se requiere puerto de laboratorio');
  const db=`rsp_reset_test_${process.pid}_${Date.now()}`;
  const control=new Pool({host:'127.0.0.1',port,user:'rsp_reset_test',database:'postgres'});
  assert.equal((await control.query('SELECT current_user')).rows[0].current_user,'rsp_reset_test');
  await control.query(`CREATE DATABASE ${db}`);
  const fotos=await fs.mkdtemp(path.join(os.tmpdir(),'rsp-epoch-'));
  Object.assign(process.env,{PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'rsp_reset_test',PGDATABASE:db,PGPASSWORD:'',NODE_ENV:'test',FOTOS_DIR:fotos,FASTIFY_SECRET:'isolated-epoch-test-secret'});
  const {myPool:pool}=await import('../src/db/pool.ts');
  const {crearHistorico}=await import('../src/services/historicos-service.ts');
  const app=Fastify();
  try {
    await ejecutarMigraciones(pool);
    assert.deepEqual((await ejecutarMigraciones(pool)).aplicadas,[]);
    await pool.query("INSERT INTO usuario(id_usuario,nombre,email,password) VALUES(1,'Admin','admin@test.local','test'),(2,'Owner','owner@test.local','test'),(3,'Perf','perf@test.local','test'); INSERT INTO usuario_rol VALUES(1,1),(2,3),(3,2); UPDATE numeracion_perforacion SET proximo=3282");
    let epoca=(await pool.query('SELECT epoca FROM epoca_datos')).rows[0].epoca;
    const body={pozo:{id_propietario:null,propietario_provisional:'Campo',id_perforador:3},sitio_nuevo:{departamento:'Salto',latitud:'-31',longitud:'-57'},intervalos_litologicos:[],intervalos_diametro:[],intervalos_filtro:[],niveles_aporte:[],foto:{mime_type:'image/png' as const,base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}};
    let historicoId:number;
    await t.test('histórico atómico e idempotente conserva NULL sin inventar sitio, personas o técnica',async()=>{
      const k=randomUUID(); const before=(await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo;
      const results=await Promise.all([crearHistorico(1,{numero_perforacion:3281},k,epoca,pool),crearHistorico(1,{numero_perforacion:3281},k,epoca,pool)]);
      assert.deepEqual(results[0],results[1]);historicoId=results[0].id_pozo;
      const row=(await pool.query('SELECT * FROM pozo WHERE id_pozo=$1',[historicoId])).rows[0];
      for(const campo of ['id_sitio','id_perforador','id_propietario','profundidad_final_m','caudal_estimado_lh','fecha_inicio','cementacion','desarrollo','metodo_rocoso']) assert.equal(row[campo],null,campo);
      assert.equal(row.origen,'historico');assert.equal(row.creado_por,'1');
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo,before);
      await assert.rejects(crearHistorico(1,{numero_perforacion:3280},k,epoca,pool),{statusCode:409});
      await assert.rejects(crearHistorico(1,{numero_perforacion:3281},randomUUID(),epoca,pool),{statusCode:409});
      await assert.rejects(pool.query('UPDATE pozo SET numero_perforacion=3280 WHERE id_pozo=$1',[historicoId]),{code:'P1102'});
      await assert.rejects(pool.query("UPDATE pozo SET origen='normal' WHERE id_pozo=$1",[historicoId]));
    });
    await t.test('históricos simultáneos y fallo técnico no adelantan contador ni dejan sitios/reservas',async()=>{
      const before=(await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo;
      const race=await Promise.allSettled([crearHistorico(1,{numero_perforacion:3280},randomUUID(),epoca,pool),crearHistorico(1,{numero_perforacion:3280},randomUUID(),epoca,pool)]);
      assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
      const sites=(await pool.query('SELECT count(*) FROM sitio')).rows[0].count;
      await assert.rejects(crearHistorico(1,{numero_perforacion:3279,sitio:{departamento:'Salto'},intervalos_litologicos:[{desde_m:0,hasta_m:2,material:'Prueba',id_litologia:9999}]},randomUUID(),epoca,pool));
      assert.equal((await pool.query('SELECT count(*) FROM sitio')).rows[0].count,sites);
      assert.equal((await pool.query('SELECT count(*) FROM numero_perforacion_reservado WHERE numero_perforacion=3279')).rows[0].count,'0');
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo,before);
      await pool.query('DELETE FROM pozo WHERE numero_perforacion=3280');
      await assert.rejects(crearHistorico(1,{numero_perforacion:3280},randomUUID(),epoca,pool),{statusCode:409});
    });
    await app.register(cookie); await app.register((await import('../src/plugins/jwt.ts')).default);
    await app.register((await import('../src/plugins/error-handler.ts')).default);
    app.decorate('notifyClient',()=>{}); app.decorate('notifyAdmin',()=>{});
    await app.register((await import('../src/routes/pozos.ts')).default);
    await app.register((await import('../src/routes/historicos.ts')).default); await app.ready();
    const {SESSION_COOKIE}=await import('../src/plugins/cookies.ts');
    const call=(actor:number,method:'POST'|'GET',url:string,payload?:unknown,version=1)=>app.inject({method,url,...(payload?{payload}:{}),cookies:{[SESSION_COOKIE]:app.jwt.sign({sub:actor,version_sesion:version},{expiresIn:'1h'})},headers:{'idempotency-key':randomUUID(),'x-epoca-datos':epoca}});
    await t.test('HTTP: sólo admin, validación estricta y sesión revocada',async()=>{
      assert.equal((await call(3,'POST','/pozos/historicos',{numero_perforacion:3279})).statusCode,403);
      assert.equal((await call(2,'POST','/pozos/historicos',{numero_perforacion:3279})).statusCode,403);
      for(const n of [0,-1,1.5,3282,'3281',true]) assert.equal((await call(1,'POST','/pozos/historicos',{numero_perforacion:n})).statusCode,400);
      const detail=await call(1,'GET',`/usuarios/1/pozos/${historicoId}`); assert.equal(detail.statusCode,200,detail.body);
      assert.equal(detail.json().origen,'historico');assert.equal(detail.json().id_sitio,null);assert.equal(detail.json().id_perforador,null);
      for (const campo of ['profundidad_final_m','caudal_estimado_lh','sello_sanitario','fecha_inicio','cementacion']) assert.equal(detail.json()[campo],undefined,campo);
      const list=await call(1,'GET','/usuarios/1/pozos'); assert.equal(list.statusCode,200,list.body);
      const listed=list.json().find((p:any)=>p.id_pozo===historicoId);
      assert.equal(listed.id_sitio,null);assert.equal(listed.id_perforador,null);assert.equal(listed.profundidad_final_m,undefined);assert.equal(listed.caudal_estimado_lh,undefined);
      const normal=await call(1,'POST','/usuarios/1/pozos/completo',{...body,pozo:{...body.pozo,numero_perforacion:3279}}); assert.notEqual(normal.statusCode,201);
      await pool.query('UPDATE usuario SET version_sesion=2 WHERE id_usuario=1');
      assert.equal((await call(1,'POST','/pozos/historicos',{numero_perforacion:3279})).statusCode,401);
    });
  } finally {
    await app.close(); await pool.end(); await control.query(`DROP DATABASE ${db} WITH (FORCE)`); await control.end();
    assert.ok(fotos.startsWith(path.join(os.tmpdir(),'rsp-epoch-'))); await fs.rm(fotos,{recursive:true,force:true});
  }
});
