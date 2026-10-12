// Nunca carga .env. Sólo usuario y puerto explícitos del laboratorio desechable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { DIRECTORIO_MIGRACIONES, ejecutarMigraciones } from '../src/db/migrator.ts';

test('carga historica en PostgreSQL aislada', async t=>{
  const port=Number(process.env.RSP_RESET_TEST_PORT);
  assert.ok(Number.isInteger(port)&&port>1024&&port!==5432,'Se requiere puerto de laboratorio');
  const db=`rsp_reset_test_${process.pid}_${Date.now()}`;
  const control=new Pool({host:'127.0.0.1',port,user:'rsp_reset_test',database:'postgres'});
  assert.equal((await control.query('SELECT current_user')).rows[0].current_user,'rsp_reset_test');
  await control.query(`CREATE DATABASE ${db}`);
  const fotos=await fs.mkdtemp(path.join(os.tmpdir(),'rsp-epoch-'));
  Object.assign(process.env,{PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'rsp_reset_test',PGDATABASE:db,NODE_ENV:'test',FOTOS_DIR:fotos,FASTIFY_SECRET:'isolated-epoch-test-secret'});
  const {myPool:pool}=await import('../src/db/pool.ts');
  const {crearHistorico}=await import('../src/services/historicos-service.ts');
  const app=Fastify();
  try {
    const previas=path.join(fotos,'migraciones-previas');
    await fs.mkdir(previas);
    const archivos=(await fs.readdir(DIRECTORIO_MIGRACIONES)).filter(f=>/^\d{3}_.*\.sql$/.test(f)).sort();
    for(const file of archivos.filter(f=>f<'018_')) await fs.copyFile(path.join(DIRECTORIO_MIGRACIONES,file),path.join(previas,file));
    assert.equal((await ejecutarMigraciones(pool,{directorio:previas})).aplicadas.length,18);
    await pool.query("INSERT INTO usuario(id_usuario,nombre,email,password) VALUES(1,'Admin','admin@test.local','test'),(2,'Owner','owner@test.local','test'),(3,'Perf','perf@test.local','test'); INSERT INTO usuario_rol VALUES(1,1),(2,3),(3,2); UPDATE numeracion_perforacion SET proximo=3282");
    await t.test('migración 018 registra sólo el rol, sin cambiar cuentas, asignaciones ni contador; reintento idempotente',async()=>{
      const snapshot=async()=>Promise.all(['usuario','usuario_rol','numeracion_perforacion'].map(async tabla=>(await pool.query(`SELECT * FROM ${tabla} ORDER BY 1,2`)).rows));
      const before=await snapshot();
      const rolesBefore=(await pool.query('SELECT * FROM rol ORDER BY id_rol')).rows;
      assert.deepEqual((await ejecutarMigraciones(pool)).aplicadas,['018_operador_administrativo.sql']);
      assert.deepEqual(await snapshot(),before);
      assert.deepEqual((await pool.query("SELECT * FROM rol WHERE nombre<>'operador_administrativo' ORDER BY id_rol")).rows,rolesBefore);
      assert.equal((await pool.query("SELECT count(*) FROM rol WHERE nombre='operador_administrativo'")).rows[0].count,'1');
      assert.deepEqual((await ejecutarMigraciones(pool)).aplicadas,[]);
      console.log('Migraciones verificadas: '+archivos.join(', '));
    });
    await pool.query("INSERT INTO usuario(id_usuario,nombre,email,password) VALUES(4,'Operador','operador@test.local','test'); INSERT INTO usuario_rol SELECT 4,id_rol FROM rol WHERE nombre='operador_administrativo'");
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
    let antesDelHandler: (()=>Promise<void>) | undefined;
    app.addHook('onRoute',route=>{
      const previos=Array.isArray(route.preHandler)?route.preHandler:route.preHandler?[route.preHandler]:[];
      route.preHandler=[...previos,async()=>{
        const paso=antesDelHandler; antesDelHandler=undefined;
        await paso?.();
      }];
    });
    for(const ruta of ['usuarios','roles','numeracion-perforacion','litologias','sitios']) await app.register((await import(`../src/routes/${ruta}.ts`)).default);
    await app.register((await import('../src/routes/pozos.ts')).default);
    await app.register((await import('../src/routes/historicos.ts')).default); await app.ready();
    const {SESSION_COOKIE}=await import('../src/plugins/cookies.ts');
    const call=(actor:number,method:'POST'|'GET'|'PATCH'|'PUT'|'DELETE',url:string,payload?:unknown,version=1)=>app.inject({method,url,...(payload?{payload}:{}),cookies:{[SESSION_COOKIE]:app.jwt.sign({sub:actor,version_sesion:version},{expiresIn:'1h'})},headers:{'idempotency-key':randomUUID(),'x-epoca-datos':epoca}});
    await t.test('roles: renombrar mayúsculas revoca sesión anterior, conserva capacidades y permite revertir',async()=>{
      const admin=(await pool.query("SELECT * FROM rol WHERE nombre='administracion'")).rows[0];
      const op=(await pool.query("SELECT * FROM rol WHERE nombre='operador_administrativo'")).rows[0];
      try {
        const cambio=await call(1,'PUT',`/roles/${admin.id_rol}`,{nombre:'Administracion',descr:admin.descr});
        assert.equal(cambio.statusCode,200,cambio.body);
        assert.equal((await call(1,'GET','/usuarios')).statusCode,401);
        assert.equal((await call(1,'GET','/usuarios',undefined,2)).statusCode,200);
        const creado=await call(1,'POST','/roles',{nombre:'temporal_auditoria',descr:'Prueba desechable'},2);
        assert.equal(creado.statusCode,201,creado.body);
        const eliminado=await call(1,'DELETE',`/roles/${creado.json().id_rol}`,undefined,2);
        assert.equal(eliminado.statusCode,204,eliminado.body);
        const revertido=await call(1,'PUT',`/roles/${admin.id_rol}`,{nombre:admin.nombre,descr:admin.descr},2);
        assert.equal(revertido.statusCode,200,revertido.body);
        assert.equal((await call(1,'GET','/usuarios',undefined,3)).statusCode,200);
        const mayuscula=await call(1,'PUT',`/roles/${op.id_rol}`,{nombre:'OPERADOR_ADMINISTRATIVO',descr:op.descr},3);
        assert.equal(mayuscula.statusCode,200,mayuscula.body);
        assert.equal((await call(4,'GET','/usuarios/999/pozos')).statusCode,401);
        assert.equal((await call(4,'GET','/usuarios/999/pozos',undefined,2)).statusCode,200);
        const editado=await call(4,'PATCH',`/pozos/historicos/${historicoId}`,{empresa:'Prueba mayúsculas'},2);
        assert.equal(editado.statusCode,200,editado.body);
        for(const url of ['/usuarios','/roles','/pozos/numeracion'])
          assert.equal((await call(4,'GET',url,undefined,2)).statusCode,403,url);
        const {exigirAdministracionNumeracion}=await import('../src/services/numeracion-perforacion-service.ts');
        await assert.rejects(exigirAdministracionNumeracion(4,pool),{statusCode:403});
      } finally {
        // Restablecer sólo fixtures de esta base desechable para las pruebas siguientes.
        await pool.query('UPDATE rol SET nombre=$2 WHERE id_rol=$1',[admin.id_rol,admin.nombre]);
        await pool.query('UPDATE rol SET nombre=$2 WHERE id_rol=$1',[op.id_rol,op.nombre]);
        await pool.query('UPDATE usuario SET version_sesion=1 WHERE id_usuario IN (1,4)');
        await pool.query('UPDATE pozo SET empresa=NULL WHERE id_pozo=$1',[historicoId]);
      }
    });
    await t.test('sitios: operador sólo consulta/edita asociados; administración conserva independientes',async()=>{
      const sitio={departamento:'Salto',localidad:'Prueba',latitud:'-31',longitud:'-57',padron:'001'};
      const id=(await pool.query("INSERT INTO sitio(departamento) VALUES('Salto') RETURNING id_sitio")).rows[0].id_sitio;
      const url=`/usuarios/999/sitios/${id}`;
      try {
        await pool.query('UPDATE pozo SET id_sitio=$1 WHERE id_pozo=$2',[id,historicoId]);
        for(const method of ['GET','PUT'] as const) {
          const r=await call(4,method,url,method==='PUT'?sitio:undefined); assert.equal(r.statusCode,200,r.body);
        }
        await pool.query('UPDATE pozo SET id_sitio=NULL WHERE id_pozo=$1',[historicoId]);
        const before=(await pool.query('SELECT * FROM sitio WHERE id_sitio=$1',[id])).rows;
        for(const multirol of [false,true]) {
          if(multirol)await pool.query('INSERT INTO usuario_rol VALUES(4,2),(4,3)');
          for(const [method,target,payload] of [
            ['GET',url],['PUT',url,{...sitio,localidad:'Prohibido'}],['DELETE',url],
            ['GET','/usuarios/999/sitios'],['POST','/usuarios/999/sitios',sitio],
          ] as const) {
            const r=await call(4,method,target,payload); assert.equal(r.statusCode,403,`${method} ${target}: ${r.body}`);
          }
        }
        assert.deepEqual((await pool.query('SELECT * FROM sitio WHERE id_sitio=$1',[id])).rows,before);
        for(const method of ['GET','PUT'] as const) {
          const r=await call(1,method,url,method==='PUT'?{...sitio,localidad:'Administración'}:undefined);
          assert.equal(r.statusCode,200,r.body);
        }
      } finally {
        await pool.query('DELETE FROM usuario_rol WHERE id_usuario=4 AND id_rol IN (2,3)');
        await pool.query('UPDATE pozo SET id_sitio=NULL WHERE id_pozo=$1',[historicoId]);
        await pool.query('DELETE FROM sitio WHERE id_sitio=$1',[id]);
      }
    });
    await t.test('sitios: desvinculación después de autorización HTTP se rechaza en transacción real',async()=>{
      const id=(await pool.query("INSERT INTO sitio(departamento) VALUES('Salto') RETURNING id_sitio")).rows[0].id_sitio;
      await pool.query('UPDATE pozo SET id_sitio=$1 WHERE id_pozo=$2',[id,historicoId]);
      const before=(await pool.query('SELECT * FROM sitio WHERE id_sitio=$1',[id])).rows;
      const gate=await pool.connect();
      let pendiente: ReturnType<typeof call> | undefined;
      try {
        await gate.query('BEGIN');
        await gate.query('SELECT pg_advisory_xact_lock(731024,1)');
        // El handler comprueba la asociación; su transacción espera el gate.
        pendiente=call(4,'PUT',`/usuarios/999/sitios/${id}`,{departamento:'Cambio prohibido'});
        const respuesta=pendiente.then(r=>r);
        let esperando=false;
        for(let intento=0;intento<200&&!esperando;intento++) {
          esperando=Boolean((await pool.query(`SELECT 1 FROM pg_stat_activity
            WHERE datname=current_database() AND pid<>pg_backend_pid()
              AND query LIKE '%pg_advisory_xact_lock_shared(731024%'
              AND cardinality(pg_blocking_pids(pid))>0`)).rows.length);
          if(!esperando)await delay(10);
        }
        assert.ok(esperando,'la petición debe alcanzar la transacción tras comprobar la asociación');
        await gate.query('UPDATE pozo SET id_sitio=NULL WHERE id_pozo=$1',[historicoId]);
        await gate.query('COMMIT');
        const r=await respuesta; assert.equal(r.statusCode,403,r.body);
        assert.deepEqual((await pool.query('SELECT * FROM sitio WHERE id_sitio=$1',[id])).rows,before);
      } finally {
        await gate.query('ROLLBACK'); gate.release();
        if(pendiente)await pendiente;
        await pool.query('UPDATE pozo SET id_sitio=NULL WHERE id_pozo=$1',[historicoId]);
        await pool.query('DELETE FROM sitio WHERE id_sitio=$1',[id]);
      }
    });
    await t.test('HTTP y SQL real: operador sin administración de cuentas, roles, numeración, catálogo ni eliminación',async()=>{
      const snapshot=async()=>Promise.all(['usuario','usuario_rol','rol','numeracion_perforacion','numero_perforacion_reservado','catalogo_litologia','pozo'].map(async tabla=>(await pool.query(`SELECT * FROM ${tabla} ORDER BY 1`)).rows));
      const before=await snapshot();
      const cuenta={nombre:'Intento',email:'intento@test.local',password:'ClaveDePrueba123!',activo:true,roles:[{id_rol:1,nombre:'administracion',descr:'Administración'}]};
      const roca={codigo:'prueba',nombre:'Prueba',familia:'otro',color:'#123456',patron:'clay',orden:1};
      const requests: Array<[Parameters<typeof call>[1],string,unknown?]>=[
        ['POST','/usuarios',cuenta],['PUT','/usuarios/4',cuenta],['DELETE','/usuarios/2'],
        ['POST','/usuarios/personas/2/acceso',{email:cuenta.email,password:cuenta.password,confirmar:cuenta.password}],
        ['DELETE','/usuarios/personas/2'],['PUT','/usuarios/4/roles/1'],
        ['POST','/roles',{nombre:'Intento',descr:'Intento'}],['PUT','/roles/2',{nombre:'Intento',descr:'Intento'}],['DELETE','/roles/2'],
        ['GET','/usuarios'],['GET','/roles'],['GET','/pozos/numeracion'],
        ['PUT','/pozos/numeracion',{proximo:5000,esperado:3282}],
        ['PATCH',`/pozos/${historicoId}/numero-perforacion`,{numero_perforacion:3000}],
        ['POST','/litologias',roca],['PUT','/litologias/1',roca],['PATCH','/litologias/1/activar'],['PATCH','/litologias/1/desactivar'],
        ['DELETE',`/usuarios/1/pozos/${historicoId}`],['POST','/pozos/propietarios',{nombre:'Identidad prohibida'}],
      ];
      for(const [method,url,payload] of requests){const r=await call(4,method,url,payload);assert.equal(r.statusCode,403,`${method} ${url}: ${r.body}`);}
      assert.deepEqual(await snapshot(),before);
      const {exigirAdministracionNumeracion}=await import('../src/services/numeracion-perforacion-service.ts');
      await assert.rejects(exigirAdministracionNumeracion(4,pool),{statusCode:403});
      await exigirAdministracionNumeracion(1,pool);
      for(const url of ['/usuarios','/roles','/pozos/numeracion']){const r=await call(1,'GET',url);assert.equal(r.statusCode,200,r.body);}
    });
    await t.test('combinación admin + operador: servicios rechazan y revierten; SQL externo puede eludirla',async()=>{
      const roles=(await pool.query('SELECT * FROM rol ORDER BY id_rol')).rows;
      const admin=roles.find(r=>r.nombre==='administracion'),op=roles.find(r=>r.nombre==='operador_administrativo');
      const snapshot=async()=>Promise.all(['usuario','usuario_rol','rol'].map(async tabla=>(await pool.query(`SELECT * FROM ${tabla} ORDER BY 1,2`)).rows));
      const before=await snapshot();
      const cuenta={nombre:'Intento',email:'intento@test.local',password:'ClaveDePrueba123!',activo:true,roles:[admin,op]};
      for(const [method,url,payload] of [['POST','/usuarios',cuenta],['PUT','/usuarios/4',cuenta],['PUT',`/usuarios/4/roles/${admin.id_rol}`,undefined]] as const){
        const r=await call(1,method,url,payload);assert.equal(r.statusCode,400,r.body);
      }
      assert.deepEqual(await snapshot(),before);
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO usuario_rol(id_usuario,id_rol) VALUES(4,$1)',[admin.id_rol]);
        assert.equal((await client.query('SELECT count(*) FROM usuario_rol WHERE id_usuario=4')).rows[0].count,'2');
      } finally {await client.query('ROLLBACK');client.release();}
      assert.deepEqual(await snapshot(),before);
    });
    await t.test('transacción: rol o versión retirados después del middleware impiden editar y crear históricos',async()=>{
      const before=(await pool.query('SELECT * FROM pozo WHERE id_pozo=$1',[historicoId])).rows;
      try {
        antesDelHandler=async()=>{await pool.query('DELETE FROM usuario_rol WHERE id_usuario=4');};
        const r=await call(4,'PATCH',`/pozos/historicos/${historicoId}`,{empresa:'No debe persistir'});
        assert.equal(r.statusCode,403,r.body);
        assert.deepEqual((await pool.query('SELECT * FROM pozo WHERE id_pozo=$1',[historicoId])).rows,before);
        await assert.rejects(crearHistorico(4,{numero_perforacion:3099},randomUUID(),epoca,pool),{statusCode:403});
        assert.equal((await pool.query('SELECT count(*) FROM numero_perforacion_reservado WHERE numero_perforacion=3099')).rows[0].count,'0');
        await pool.query("INSERT INTO usuario_rol SELECT 4,id_rol FROM rol WHERE nombre='operador_administrativo'");
        antesDelHandler=async()=>{await pool.query('UPDATE usuario SET version_sesion=2 WHERE id_usuario=4');};
        const revocado=await call(4,'PATCH',`/pozos/historicos/${historicoId}`,{empresa:'Tampoco debe persistir'});
        assert.equal(revocado.statusCode,401,revocado.body);
        assert.deepEqual((await pool.query('SELECT * FROM pozo WHERE id_pozo=$1',[historicoId])).rows,before);
      } finally {
        antesDelHandler=undefined;
        await pool.query("INSERT INTO usuario_rol SELECT 4,id_rol FROM rol WHERE nombre='operador_administrativo' ON CONFLICT DO NOTHING; UPDATE usuario SET version_sesion=1 WHERE id_usuario=4");
      }
    });
    await t.test('HTTP: operador crea y edita históricos sin cambiar contador ni crear identidades',async()=>{
      const antes = (await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo;
      const personas = (await pool.query('SELECT count(*) FROM usuario')).rows[0].count;
      const creado = await call(4,'POST','/pozos/historicos',{numero_perforacion:3100});
      assert.equal(creado.statusCode,201,creado.body);
      const id = creado.json().id_pozo;
      const editado = await call(4,'PATCH',`/pozos/historicos/${id}`,{empresa:'Dato del operador'});
      assert.equal(editado.statusCode,200,editado.body);
      assert.equal((await call(4,'GET',`/usuarios/999/pozos/${historicoId}`)).statusCode,200);
      assert.equal((await call(4,'GET','/usuarios/999/pozos')).statusCode,200);
      assert.equal((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo,antes);
      assert.equal((await pool.query('SELECT count(*) FROM usuario')).rows[0].count,personas);
      await pool.query('UPDATE usuario SET version_sesion=2 WHERE id_usuario=4');
      assert.equal((await call(4,'PATCH',`/pozos/historicos/${id}`,{empresa:'Revocado'})).statusCode,401);
    });
    await t.test('HTTP: roles de consulta/campo denegados, validación estricta y sesión revocada',async()=>{
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
