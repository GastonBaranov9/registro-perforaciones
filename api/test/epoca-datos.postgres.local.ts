// Nunca carga .env. Sólo usuario y puerto explícitos del laboratorio desechable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { ejecutarMigraciones } from '../src/db/migrator.ts';

test('epoca offline en PostgreSQL aislada', async t=>{
  const port=Number(process.env.RSP_RESET_TEST_PORT);
  assert.ok(Number.isInteger(port)&&port>1024&&port!==5432,'Se requiere puerto de laboratorio');
  const db=`rsp_reset_test_${process.pid}_${Date.now()}`;
  const control=new Pool({host:'127.0.0.1',port,user:'rsp_reset_test',database:'postgres'});
  assert.equal((await control.query('SELECT current_user')).rows[0].current_user,'rsp_reset_test');
  await control.query(`CREATE DATABASE ${db}`);
  const fotos=await fs.mkdtemp(path.join(os.tmpdir(),'rsp-epoch-'));
  Object.assign(process.env,{PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'rsp_reset_test',PGDATABASE:db,PGPASSWORD:'',NODE_ENV:'test',FOTOS_DIR:fotos,FASTIFY_SECRET:'isolated-epoch-test-secret'});
  const {myPool:pool}=await import('../src/db/pool.ts');
  const {crearPozoCompleto}=await import('../src/services/pozo-completo-service.ts');
  const {cerrarOperacionOffline}=await import('../src/services/offline-cierre-service.ts');
  const {exigirEpoca}=await import('../src/services/epoca-datos-service.ts');
  try {
    await ejecutarMigraciones(pool);
    assert.deepEqual((await ejecutarMigraciones(pool)).aplicadas,[]);
    await pool.query("INSERT INTO usuario(id_usuario,nombre,email,password) VALUES(1,'Admin','admin@test.local','test'),(2,'Owner','owner@test.local','test'),(3,'Perf','perf@test.local','test'); INSERT INTO usuario_rol VALUES(1,1),(2,3),(3,2); UPDATE numeracion_perforacion SET proximo=3282");
    let epoca=(await pool.query('SELECT epoca FROM epoca_datos')).rows[0].epoca;
    const body={pozo:{id_propietario:null,propietario_provisional:'Campo',id_perforador:3},sitio_nuevo:{departamento:'Salto',latitud:'-31',longitud:'-57'},intervalos_litologicos:[],intervalos_diametro:[],intervalos_filtro:[],niveles_aporte:[],foto:{mime_type:'image/png' as const,base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}};
    const key=randomUUID();
    await t.test('idempotencia actual conserva UUID, foto y número ante reintentos concurrentes',async()=>{
      const results=await Promise.all(Array.from({length:4},()=>crearPozoCompleto(3,body,fotos,pool,key,epoca)));
      assert.ok(results.every(r=>r.pozo.numero_perforacion===3282));
      assert.equal((await pool.query('SELECT count(*) FROM pozo')).rows[0].count,'1');
      assert.ok((await fs.readdir(fotos)).includes(`pozo-${results[0].pozo.id_pozo}.png`));
      assert.equal((await cerrarOperacionOffline(3,key,epoca)).estado,'confirmado');
    });
    await t.test('clave cerrada y ausencia de época no crean datos',async()=>{
      const closed=randomUUID(); assert.equal((await cerrarOperacionOffline(3,closed,epoca)).estado,'cerrado_sin_creacion');
      await assert.rejects(crearPozoCompleto(3,body,fotos,pool,closed,epoca),{code:'OFFLINE_CLAVE_CERRADA'});
      await assert.rejects(crearPozoCompleto(3,body,fotos,pool,randomUUID()),{statusCode:410});
      await assert.rejects(cerrarOperacionOffline(3,randomUUID()),{statusCode:410});
    });
    await t.test('cambio de época bloquea incluso recibos confirmados; no toca fotos ni UUID',async()=>{
      const old=epoca; epoca=randomUUID(); await pool.query('UPDATE epoca_datos SET epoca=$1',[epoca]);
      await assert.rejects(crearPozoCompleto(3,body,fotos,pool,key,old),{statusCode:410});
      await assert.rejects(cerrarOperacionOffline(3,key,old),{statusCode:410});
      await assert.rejects(crearPozoCompleto(3,body,fotos,pool,randomUUID(),old),{statusCode:410});
      assert.equal((await pool.query('SELECT count(*) FROM pozo')).rows[0].count,'1');
    });
    await t.test('lock de época mantiene una operación en su corte transaccional',async()=>{
      const a=await pool.connect(),b=await pool.connect();
      try {
        await a.query('BEGIN'); await exigirEpoca(a,epoca);
        await b.query('BEGIN'); await b.query("SET LOCAL lock_timeout='100ms'");
        await assert.rejects(b.query('UPDATE epoca_datos SET epoca=$1',[randomUUID()]),{code:'55P03'});
      } finally {await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();}
    });
  } finally {
    await pool.end(); await control.query(`DROP DATABASE ${db} WITH (FORCE)`); await control.end();
    assert.ok(fotos.startsWith(path.join(os.tmpdir(),'rsp-epoch-'))); await fs.rm(fotos,{recursive:true,force:true});
  }
});
