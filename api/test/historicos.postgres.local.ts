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
    const call=(actor:number,method:'POST'|'GET'|'PATCH',url:string,payload?:unknown,version=1)=>app.inject({method,url,...(payload?{payload}:{}),cookies:{[SESSION_COOKIE]:app.jwt.sign({sub:actor,version_sesion:version},{expiresIn:'1h'})},headers:{'idempotency-key':randomUUID(),'x-epoca-datos':epoca}});
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
    const completo={
      id_propietario:2,id_perforador:3,empresa:'Empresa documentada',fecha_inicio:'1998-03-01',fecha_fin:'1998-03-04',
      profundidad_final_m:40,nivel_estatico_m:3.5,nivel_dinamico_m:7.25,caudal_estimado_lh:1200,
      metodo_sedimentario:'Rotación',metodo_rocoso:'Percusión',cementacion:'Documentada',desarrollo:'Aire',revestimiento:'PVC',
      sitio:{departamento:'Salto',localidad:'Campo',padron:'182',latitud:'-31',longitud:'-57'},
      intervalos_litologicos:[{desde_m:0,hasta_m:40,material:'Documentado',id_litologia:1}],
      intervalos_diametro:[{desde_m:0,hasta_m:40,diametro_pulg:6,material_tuberia:'PVC' as const}],
      intervalos_filtro:[{desde_m:20,hasta_m:30,diametro_pulg:4,material_tuberia:'PVC' as const,ranura_mm:0.75 as const}],
      niveles_aporte:[{profundidad_m:25}],foto:body.foto,
    };
    await t.test('histórico completo con foto: concurrencia/reintento no duplican hijos ni reservas',async()=>{
      const key=randomUUID(),data={numero_perforacion:3279,...completo};
      const [a,b]=await Promise.all([crearHistorico(1,data,key,epoca,pool),crearHistorico(1,data,key,epoca,pool)]);
      assert.deepEqual(a,b);
      const row=(await pool.query('SELECT * FROM pozo WHERE id_pozo=$1',[a.id_pozo])).rows[0];
      for(const k of ['empresa','metodo_sedimentario','metodo_rocoso','cementacion','desarrollo','revestimiento'] as const)assert.equal(row[k],completo[k]);
      for(const k of ['profundidad_final_m','nivel_estatico_m','nivel_dinamico_m','caudal_estimado_lh'] as const)assert.equal(Number(row[k]),completo[k]);
      assert.equal(new Date(row.fecha_inicio).toISOString().slice(0,10),completo.fecha_inicio);
      const site=(await pool.query('SELECT * FROM sitio WHERE id_sitio=$1',[row.id_sitio])).rows[0];
      assert.equal(site.padron,'182');assert.equal(Number(site.latitud),-31);assert.equal(Number(site.longitud),-57);
      assert.deepEqual(await fs.readFile(path.join(fotos,`pozo-${a.id_pozo}.png`)),Buffer.from(body.foto.base64,'base64'));
      for(const table of ['intervalo_litologico','intervalo_diametro_perforacion','intervalo_filtro','nivel_aporte'])assert.equal((await pool.query(`SELECT count(*) FROM ${table} WHERE id_pozo=$1`,[a.id_pozo])).rows[0].count,'1');
      assert.equal((await pool.query('SELECT count(*) FROM numero_perforacion_reservado WHERE numero_perforacion=3279')).rows[0].count,'1');
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo,'3282');
      const before=(await pool.query('SELECT count(*) FROM sitio')).rows[0].count;
      await assert.rejects(crearHistorico(1,{...data,numero_perforacion:3278,foto:{...body.foto,base64:'invalida'}},randomUUID(),epoca,pool));
      assert.equal((await pool.query('SELECT count(*) FROM sitio')).rows[0].count,before);
      assert.equal((await pool.query('SELECT count(*) FROM numero_perforacion_reservado WHERE numero_perforacion=3278')).rows[0].count,'0');
      const filesBefore=(await fs.readdir(fotos)).sort();
      // Falla después de promover la foto y antes de COMMIT: compensar DB y FS.
      const failingPool={connect:async()=>{
        const client=await pool.connect();
        return {query:async(sql:string,params?:unknown[])=>{
          if(sql.startsWith('INSERT INTO creacion_historica'))throw Error('fallo posterior a foto');
          return client.query(sql,params);
        },release:(discard?:boolean)=>client.release(discard)};
      }};
      await assert.rejects(crearHistorico(1,{...data,numero_perforacion:3278},randomUUID(),epoca,failingPool as never),/fallo posterior a foto/);
      assert.deepEqual((await fs.readdir(fotos)).sort(),filesBefore);
      assert.equal((await pool.query('SELECT count(*) FROM numero_perforacion_reservado WHERE numero_perforacion=3278')).rows[0].count,'0');
    });
    await t.test('P-3281 parcial existente se completa desde API sin recrear ni cambiar numeración/reserva',async()=>{
      const reservation=(await pool.query('SELECT * FROM numero_perforacion_reservado WHERE numero_perforacion=3281')).rows[0];
      const url=`/pozos/historicos/${historicoId}`;
      const result=await call(1,'PATCH',url,{...completo,foto_accion:'reemplazar'},2);
      assert.equal(result.statusCode,200,result.body);assert.equal(result.json().id_pozo,historicoId);
      const normalEdit=await app.inject({method:'PUT',url:`/usuarios/1/pozos/${historicoId}/completo`,cookies:{[SESSION_COOKIE]:app.jwt.sign({sub:1,version_sesion:2},{expiresIn:'1h'})},payload:{pozo:{id_propietario:2,id_perforador:3,id_sitio:1},intervalos_litologicos:[],intervalos_diametro:[],intervalos_filtro:[],niveles_aporte:[],foto_accion:'conservar'}});
      assert.equal(normalEdit.statusCode,400,normalEdit.body);
      assert.deepEqual((await pool.query('SELECT * FROM numero_perforacion_reservado WHERE numero_perforacion=3281')).rows[0],reservation);
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo,'3282');
      const row=(await pool.query('SELECT * FROM pozo WHERE id_pozo=$1',[historicoId])).rows[0];
      assert.equal(row.numero_perforacion,3281);assert.equal(row.origen,'historico');assert.equal(row.id_propietario,'2');assert.equal(row.id_perforador,'3');assert.ok(row.id_sitio);
      const childBefore=(await pool.query('SELECT * FROM intervalo_litologico WHERE id_pozo=$1',[historicoId])).rows;
      const photoBefore=await fs.readFile(path.join(fotos,`pozo-${historicoId}.png`));
      const concurrent=await Promise.all([call(1,'PATCH',url,{empresa:'Corregida'},2),call(1,'PATCH',url,{nivel_estatico_m:0},2)]);
      assert(concurrent.every(r=>r.statusCode===200));
      assert.deepEqual((await pool.query('SELECT * FROM intervalo_litologico WHERE id_pozo=$1',[historicoId])).rows,childBefore);
      assert.deepEqual(await fs.readFile(path.join(fotos,`pozo-${historicoId}.png`)),photoBefore);
      for(const immutable of [{numero_perforacion:3280},{numero_perforacion:3281},{origen:'normal'},{origen:'historico'},{id_pozo:99}])assert.equal((await call(1,'PATCH',url,immutable,2)).statusCode,400);
      for(const actor of [2,3])assert.equal((await call(actor,'PATCH',url,{empresa:'No autorizado'})).statusCode,403);
      assert.equal((await call(1,'PATCH',url,{empresa:'Sesión revocada'},1)).statusCode,401);
      const invalid=await call(1,'PATCH',url,{empresa:'No debe persistir',foto_accion:'reemplazar',foto:{...body.foto,base64:'invalida'}},2);
      assert.equal(invalid.statusCode,400,invalid.body);
      assert.equal((await pool.query('SELECT empresa FROM pozo WHERE id_pozo=$1',[historicoId])).rows[0].empresa,'Corregida');
      assert.deepEqual(await fs.readFile(path.join(fotos,`pozo-${historicoId}.png`)),photoBefore);
      assert.equal((await call(1,'PATCH',url,{profundidad_final_m:10},2)).statusCode,400,'no reducir profundidad bajo los hijos existentes');
      const hijos=await call(1,'PATCH',url,{intervalos_diametro:[{desde_m:0,hasta_m:40,diametro_pulg:8,material_tuberia:'Acero'}]},2);
      assert.equal(hijos.statusCode,200,hijos.body);
      assert.equal((await pool.query('SELECT count(*) FROM intervalo_filtro WHERE id_pozo=$1',[historicoId])).rows[0].count,'1');
      assert.equal((await call(1,'PATCH',url,{foto_accion:'eliminar'},2)).statusCode,200);
      await assert.rejects(fs.stat(path.join(fotos,`pozo-${historicoId}.png`)),{code:'ENOENT'});
      assert.equal((await call(1,'PATCH',url,{foto_accion:'reemplazar',foto:body.foto},2)).statusCode,200);
      assert.deepEqual((await pool.query('SELECT * FROM numero_perforacion_reservado WHERE numero_perforacion=3281')).rows[0],reservation);
    });
    await t.test('alta normal sigue automática y obtiene 3282 exclusivamente en este fixture',async()=>{
      const cookies={[SESSION_COOKIE]:app.jwt.sign({sub:1,version_sesion:2},{expiresIn:'1h'})};
      const send=(payload:unknown)=>app.inject({method:'POST',url:'/usuarios/1/pozos/completo',cookies,payload});
      for(const n of [3280,3282])assert.equal((await send({...body,pozo:{...body.pozo,numero_perforacion:n}})).statusCode,400);
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo,'3282');
      const result=await send(body);assert.equal(result.statusCode,201,result.body);assert.equal(result.json().pozo.numero_perforacion,3282);
      assert.equal((await call(1,'PATCH',`/pozos/historicos/${result.json().pozo.id_pozo}`,{empresa:'No'},2)).statusCode,400);
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo,'3283');
    });
  } finally {
    await app.close(); await pool.end(); await control.query(`DROP DATABASE ${db} WITH (FORCE)`); await control.end();
    assert.ok(fotos.startsWith(path.join(os.tmpdir(),'rsp-epoch-'))); await fs.rm(fotos,{recursive:true,force:true});
  }
});
