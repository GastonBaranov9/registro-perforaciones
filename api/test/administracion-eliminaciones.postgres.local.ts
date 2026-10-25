// Clúster nuevo, datos ficticios, puerto loopback aleatorio. No carga .env ni usa Docker productivo.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, unlinkSync, mkdirSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import Fastify from 'fastify';
import { ejecutarMigraciones } from '../src/db/migrator.ts';
process.env.NODE_ENV='test';
for(const key of Object.keys(process.env))if(/^(PG|POSTGRES_)/i.test(key))delete process.env[key];
const root=mkdtempSync(path.join(tmpdir(),'rsp-eliminaciones-pg-'));
const fotos=path.join(root,'persistencia','fotos');mkdirSync(fotos,{recursive:true});process.env.FOTOS_DIR=fotos;
const {consultarEliminacion:consultar,ejecutarEliminacion:ejecutar}=await import('../src/services/administracion-eliminaciones-service.ts');
const {crearHistorico}=await import('../src/services/historicos-service.ts');
const {myPool}=await import('../src/db/pool.ts');
const {T05SinPermiso}=await import('../src/models/errors.ts');
const bin='C:/Program Files/PostgreSQL/18/bin',data=path.join(root,'data'),password=randomBytes(24).toString('hex');
const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));
const address=listener.address();assert.ok(address&&typeof address==='object');const port=address.port;
await new Promise<void>((r,j)=>listener.close(e=>e?j(e):r()));
function pg(command:string,args:string[]){return execFileSync(path.join(bin,command+'.exe'),args,{env:{...process.env,PGPASSWORD:password},encoding:'utf8',windowsHide:true,timeout:60000,stdio:command==='pg_ctl'?'ignore':['pipe','pipe','pipe']});}
let started=false,pool:Pool|undefined,passed=0;
async function check(name:string,fn:()=>Promise<void>){await fn();passed++;console.log('PASS '+name);}
try {
  const pw=path.join(root,'password');writeFileSync(pw,password);
  pg('initdb',['-D',data,'-U','postgres','--auth=scram-sha-256','--pwfile='+pw,'--encoding=UTF8','--locale=C']);unlinkSync(pw);
  started=true;pg('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=15`,'-w','start']);
  pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',max:6});
  assert.equal(path.resolve((await pool.query('SHOW data_directory')).rows[0].data_directory).toLowerCase(),path.resolve(data).toLowerCase());
  const anteriores=path.join(root,'migraciones022');mkdirSync(anteriores);
  for(const f of readdirSync('db/migrations').filter(f=>/^0(0|1|2[0-2])/.test(f)))copyFileSync('db/migrations/'+f,path.join(anteriores,f));
  await ejecutarMigraciones(pool,{directorio:anteriores,logger:()=>{}});
  await check('migración 022 → 023, repetible sin modificar 000–022',async()=>{
    assert.deepEqual((await ejecutarMigraciones(pool!,{logger:()=>{}})).aplicadas,['023_administracion_eliminaciones.sql','024_reingreso_historico_y_numeracion.sql']);
    assert.deepEqual((await ejecutarMigraciones(pool!,{logger:()=>{}})).aplicadas,[]);
  });
  await pool.query(`INSERT INTO usuario(id_usuario,nombre,email,password,cuenta_acceso) VALUES
    (1,'Admin','admin@example.test','no-login',TRUE),(2,'Perforador','p@example.test','no-login',TRUE),(3,'Propietario',NULL,NULL,FALSE);
    INSERT INTO usuario_rol SELECT 1,id_rol FROM rol WHERE nombre='administracion';
    INSERT INTO usuario_rol SELECT 2,id_rol FROM rol WHERE nombre='perforador';
    INSERT INTO sitio(departamento) VALUES('Salto');
    INSERT INTO pozo(origen,numero_perforacion,creado_por) VALUES('historico',3277,1),('historico',3281,1);
    UPDATE numeracion_perforacion SET proximo=3282;`);
  const id=Number((await pool.query('SELECT id_pozo FROM pozo WHERE numero_perforacion=3277')).rows[0].id_pozo);
  const bytes=Buffer.from([255,216,255,42]);writeFileSync(path.join(fotos,`pozo-${id}.jpg`),bytes);
  await pool.query("UPDATE pozo SET foto_url='foto-protegida' WHERE id_pozo=$1",[id]);
  const count=async()=> (await pool!.query(`SELECT jsonb_build_object('pozos',(SELECT jsonb_agg(p ORDER BY id_pozo) FROM pozo p),'reservas',(SELECT jsonb_agg(r ORDER BY numero_perforacion) FROM numero_perforacion_reservado r),'contador',(SELECT to_jsonb(n) FROM numeracion_perforacion n),'auditoria',(SELECT jsonb_agg(a ORDER BY id) FROM administracion_eliminacion a)) AS datos`)).rows[0].datos;
  const body=(token:string|null,liberar=false)=>({token:token!,confirmacion:liberar?'LIBERAR':'ELIMINAR',motivo:'Rectificación de datos ficticios de ensayo',sin_referencias_externas:true,prueba_confirmada:!liberar});
  const normal=await consultar(1,'eliminar',id,pool);
  await check('consulta/cancelación sin escrituras; no administrador rechazado',async()=>{
    const before=await count();await consultar(1,'eliminar',id,pool!);assert.deepEqual(await count(),before);
    await assert.rejects(consultar(2,'eliminar',id,pool!),{statusCode:403});
    await assert.rejects(ejecutar(2,'eliminar',id,body(normal.token),fotos,pool!),{statusCode:409});
  });
  await check('token obligatorio, ligado a usuario, registro, operación, firma y expiración',async()=>{
    for(const token of ['',normal.token+'x'])await assert.rejects(ejecutar(1,'eliminar',id,body(token),fotos,pool!));
    await assert.rejects(ejecutar(1,'eliminar_prueba',id,body(normal.token),fotos,pool!),{statusCode:409});
    await assert.rejects(ejecutar(1,'eliminar',id+1,body(normal.token),fotos,pool!),{statusCode:409});
    const now=Date.now;try{Date.now=()=>now()+6*60000;await assert.rejects(ejecutar(1,'eliminar',id,body(normal.token),fotos,pool!),{statusCode:409});}finally{Date.now=now;}
    await assert.rejects(ejecutar(1,'eliminar',id,{...body(normal.token),confirmacion:'',motivo:'x'},fotos,pool!),{statusCode:400});
  });
  await check('fallo de auditoría revierte todo y conserva fotografía',async()=>{
    await pool!.query(`CREATE FUNCTION fallo_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo-simulado'; END $$;
      CREATE TRIGGER fallo_test BEFORE INSERT ON administracion_eliminacion FOR EACH ROW EXECUTE FUNCTION fallo_test();`);
    const before=await count();await assert.rejects(ejecutar(1,'eliminar',id,body(normal.token),fotos,pool!),/fallo-simulado/);assert.deepEqual(await count(),before);
    assert.deepEqual(readFileSync(path.join(fotos,`pozo-${id}.jpg`)),bytes);await pool!.query('DROP TRIGGER fallo_test ON administracion_eliminacion');
  });
  await check('eliminación normal conserva reserva y archiva datos/foto; token no reutilizable',async()=>{
    await ejecutar(1,'eliminar',id,{...body(normal.token),prueba_confirmada:false},fotos,pool!);
    assert.equal((await pool!.query('SELECT count(*) FROM pozo WHERE id_pozo=$1',[id])).rows[0].count,'0');
    assert.equal((await pool!.query('SELECT count(*) FROM numero_perforacion_reservado WHERE numero_perforacion=3277')).rows[0].count,'1');
    const a=(await pool!.query('SELECT anterior FROM administracion_eliminacion')).rows[0].anterior;
    assert.equal(a.fotos[0].sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(a.pozo.id_pozo,id);
    assert.deepEqual(readFileSync(path.join(fotos,`pozo-${id}.jpg`)),bytes);
    await assert.rejects(ejecutar(1,'eliminar',id,body(normal.token),fotos,pool!),{statusCode:409});
  });
  const epoch=(await pool.query('SELECT epoca FROM epoca_datos')).rows[0].epoca;
  const clave=randomUUID(),payload={numero_perforacion:3277,foto:{mime_type:'image/jpeg' as const,base64:bytes.toString('base64')}};
  await check('intento histórico rechazado no consume idempotencia',async()=>{
    await assert.rejects(crearHistorico(1,payload,clave,epoch,pool!),{statusCode:409});
    assert.equal((await pool!.query('SELECT count(*) FROM creacion_historica WHERE clave=$1',[clave])).rows[0].count,'0');
  });
  await check('referencias históricas/offline bloquean liberación de reserva eliminada',async()=>{
    for(const tabla of ['creacion_historica','creacion_offline']) {
      const result=tabla==='creacion_offline'?{pozo:{id_pozo:id,numero_perforacion:3277}}:{id_pozo:id,numero_perforacion:3277};
      const key=randomUUID();await pool!.query(`INSERT INTO ${tabla}(actor,clave,epoca,huella,resultado) VALUES(1,$1,$2,repeat('a',64),$3)`,[key,epoch,result]);
      const v=await consultar(1,'liberar_reserva',3277,pool!);assert.equal(v.elegible,false);assert.equal(v.token,null);
      await pool!.query(`DELETE FROM ${tabla} WHERE clave=$1`,[key]);
    }
  });
  await check('liberación individual 3277 conserva contador 3282; auditoría inmutable',async()=>{
    const before=(await pool!.query('SELECT * FROM numeracion_perforacion')).rows;
    const v=await consultar(1,'liberar_reserva',3277,pool!);assert.equal(v.elegible,true);
    assert.equal((await ejecutar(1,'liberar_reserva',3277,body(v.token,true),fotos,pool!)).proximo,3282);
    assert.deepEqual((await pool!.query('SELECT * FROM numeracion_perforacion')).rows,before);
    for(const sql of ['DELETE FROM administracion_eliminacion','UPDATE administracion_eliminacion SET motivo=motivo','TRUNCATE administracion_eliminacion'])await assert.rejects(pool!.query(sql),/inmutable/);
    await assert.rejects(consultar(1,'liberar_reserva',0,pool!),{statusCode:400});
    assert.equal((await consultar(1,'liberar_reserva',3281,pool!)).elegible,false);
  });
  await check('reserva antigua sin evidencia de eliminación no se ofrece como recuperable',async()=>{
    await pool!.query("INSERT INTO pozo(origen,numero_perforacion,creado_por) VALUES('historico',3275,1); DELETE FROM pozo WHERE numero_perforacion=3275");
    const v=await consultar(1,'liberar_reserva',3275,pool!);assert.equal(v.elegible,false);assert.equal(v.token,null);assert.ok(v.bloqueos.some(b=>b.includes('auditoría')));
  });
  await check('reintento histórico mismo payload/clave/foto, ID nuevo, una creación concurrente',async()=>{
    const [a,b]=await Promise.all([crearHistorico(1,payload,clave,epoch,pool!),crearHistorico(1,payload,clave,epoch,pool!)]);
    assert.equal(a.id_pozo,b.id_pozo);assert.notEqual(Number(a.id_pozo),id);
    assert.deepEqual(readFileSync(path.join(fotos,`pozo-${a.id_pozo}.jpg`)),bytes);
    assert.equal((await pool!.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo,'3282');
    const v=await consultar(1,'eliminar_prueba',Number(a.id_pozo),pool!);assert.equal(v.elegible,false);
    const n=await consultar(1,'eliminar',Number(a.id_pozo),pool!);await ejecutar(1,'eliminar',Number(a.id_pozo),{...body(n.token),prueba_confirmada:false},fotos,pool!);
    await assert.rejects(crearHistorico(1,payload,clave,epoch,pool!),/original fue eliminada/);
    assert.equal((await consultar(1,'liberar_reserva',3277,pool!)).elegible,false);
  });
  const nuevo=async()=>Number((await pool!.query('INSERT INTO pozo(id_propietario,id_perforador,id_sitio) VALUES(3,2,1) RETURNING id_pozo')).rows[0].id_pozo);
  const test=await nuevo();
  await check('documentos e informes impiden eliminar como prueba',async()=>{
    await pool!.query("INSERT INTO documento(id_pozo,nombre_archivo) VALUES($1,'ficticio.pdf')",[test]);
    assert.equal((await consultar(1,'eliminar_prueba',test,pool!)).elegible,false);await pool!.query('DELETE FROM documento WHERE id_pozo=$1',[test]);
    await pool!.query("INSERT INTO informe(id_pozo,titulo,generado_por) VALUES($1,'ficticio',1)",[test]);
    assert.equal((await consultar(1,'eliminar_prueba',test,pool!)).elegible,false);await pool!.query('DELETE FROM informe WHERE id_pozo=$1',[test]);
  });
  await check('motivo, prueba y declaración necesarios; estado cambiado invalida token',async()=>{
    const v=await consultar(1,'eliminar_prueba',test,pool!);
    for(const change of [{prueba_confirmada:false},{sin_referencias_externas:false},{motivo:''}])await assert.rejects(ejecutar(1,'eliminar_prueba',test,{...body(v.token),...change},fotos,pool!),{statusCode:400});
    await pool!.query("UPDATE pozo SET empresa='Modificado' WHERE id_pozo=$1",[test]);
    await assert.rejects(ejecutar(1,'eliminar_prueba',test,body(v.token),fotos,pool!),{statusCode:409});
  });
  await check('documentación archivada sigue bloqueando tras eliminación normal',async()=>{
    const other=Number((await pool!.query("INSERT INTO pozo(origen,numero_perforacion,creado_por) VALUES('historico',3276,1) RETURNING id_pozo")).rows[0].id_pozo);
    await pool!.query("INSERT INTO documento(id_pozo,nombre_archivo) VALUES($1,'referencia-ficticia.pdf')",[other]);
    const v=await consultar(1,'eliminar',other,pool!);
    await ejecutar(1,'eliminar',other,{...body(v.token),prueba_confirmada:false},fotos,pool!);
    const reserva=await consultar(1,'liberar_reserva',3276,pool!);
    assert.equal(reserva.elegible,false);assert.ok(reserva.bloqueos.some(b=>b.includes('documentos o informes')));
  });
  await check('cuenta deshabilitada después de confirmar no puede ejecutar',async()=>{
    const v=await consultar(1,'eliminar_prueba',test,pool!);await pool!.query('UPDATE usuario SET activo=FALSE WHERE id_usuario=1');
    await assert.rejects(ejecutar(1,'eliminar_prueba',test,body(v.token),fotos,pool!),{statusCode:403});await pool!.query('UPDATE usuario SET activo=TRUE WHERE id_usuario=1');
  });
  await check('fallo después de borrar, al liberar reserva: rollback completo',async()=>{
    const v=await consultar(1,'eliminar_prueba',test,pool!);const before=await count();
    await pool!.query('CREATE TRIGGER fallo_test BEFORE DELETE ON numero_perforacion_reservado FOR EACH ROW EXECUTE FUNCTION fallo_test()');
    await assert.rejects(ejecutar(1,'eliminar_prueba',test,body(v.token),fotos,pool!),/fallo-simulado/);assert.deepEqual(await count(),before);
    await pool!.query('DROP TRIGGER fallo_test ON numero_perforacion_reservado');
  });
  await check('doble confirmación concurrente sólo elimina/libera una vez',async()=>{
    const v=await consultar(1,'eliminar_prueba',test,pool!);
    const r=await Promise.allSettled([ejecutar(1,'eliminar_prueba',test,body(v.token),fotos,pool!),ejecutar(1,'eliminar_prueba',test,body(v.token),fotos,pool!)]);
    assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal((await pool!.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo,'3282');
  });
  await check('creación concurrente invalida liberación; no se retrocede sobre números nuevos',async()=>{
    const id=await nuevo();const v=await consultar(1,'eliminar_prueba',id,pool!);
    const writer=await pool!.connect();await writer.query('BEGIN');await writer.query('SELECT singleton FROM numeracion_perforacion FOR UPDATE');
    const pending=ejecutar(1,'eliminar_prueba',id,body(v.token),fotos,pool!).then(()=>null,e=>e);
    await writer.query('INSERT INTO pozo(id_propietario,id_perforador,id_sitio) VALUES(3,2,1)');await writer.query('COMMIT');writer.release();
    assert.equal((await pending).statusCode,409);assert.equal((await consultar(1,'eliminar_prueba',id,pool!)).elegible,false);
  });
  await check('fotografía faltante bloquea eliminación sin cambios',async()=>{
    const id=await nuevo();await pool!.query("UPDATE pozo SET foto_url='faltante' WHERE id_pozo=$1",[id]);
    const v=await consultar(1,'eliminar',id,pool!);const before=await count();
    await assert.rejects(ejecutar(1,'eliminar',id,body(v.token),fotos,pool!),/Falta una fotografía/);assert.deepEqual(await count(),before);
  });
  await check('HTTP real: frontend antiguo rechazado, roles y fotografía eliminada inaccesible',async()=>{
    const oldQuery=myPool.query,oldConnect=myPool.connect;myPool.query=pool!.query.bind(pool);myPool.connect=pool!.connect.bind(pool);
    const app=Fastify();
    app.decorate('authenticate',async req=>{req.user={sub:Number(req.headers['x-test-user']??1)} as typeof req.user;});
    app.decorate('userIsAdmin',async req=>{if(Number(req.user.sub)!==1)throw new T05SinPermiso();});
    for(const name of ['puedeOperarTodosLosPozos','puedeOperarPozos','pozoIsFromUser','puedeConsultarRecursos','userIsSelf'])app.decorate(name,async()=>{});
    app.decorate('notifyClient',()=>{});
    try {
      await app.register((await import('../src/routes/pozos.ts')).default);
      await app.register((await import('../src/routes/administracion-eliminaciones.ts')).default);
      const live=await nuevo();
      assert.equal((await app.inject({method:'DELETE',url:`/usuarios/1/pozos/${live}`})).statusCode,400);
      assert.equal((await app.inject({method:'GET',url:`/pozos/${live}/confirmacion-eliminacion`,headers:{'x-test-user':'2'}})).statusCode,403);
      const v=(await app.inject({method:'GET',url:`/pozos/${live}/confirmacion-eliminacion`})).json();
      assert.equal((await app.inject({method:'DELETE',url:`/usuarios/1/pozos/${live}`,payload:body(v.token),headers:{'x-test-user':'2'}})).statusCode,403);
      const deleted=await app.inject({method:'DELETE',url:`/usuarios/1/pozos/${live}`,payload:{...body(v.token),prueba_confirmada:false}});assert.equal(deleted.statusCode,204,deleted.body);
      assert.equal((await app.inject({method:'GET',url:`/usuarios/1/pozos/${id}/foto`})).statusCode,404);
    }finally{await app.close();myPool.query=oldQuery;myPool.connect=oldConnect;}
  });
  await check('dump y restauración en base nueva conservan auditoría, datos y secuencias',async()=>{
    const dump=path.join(root,'database.dump');const args=['-h','127.0.0.1','-p',String(port),'-U','postgres'];
    pg('pg_dump',[...args,'-Fc','-f',dump,'postgres']);assert.ok(readFileSync(dump).length>1000);
    pg('pg_restore',['--list',dump]);await pool!.query('CREATE DATABASE recuperacion_aislada');
    pg('pg_restore',[...args,'--exit-on-error','--dbname=recuperacion_aislada',dump]);
    const restored=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'recuperacion_aislada'});
    try{for(const table of ['pozo','numero_perforacion_reservado','numeracion_perforacion','administracion_eliminacion','creacion_historica']){
      const query=`SELECT to_jsonb(t) AS dato FROM ${table} t ORDER BY to_jsonb(t)::text`;
      assert.deepEqual((await restored.query(query)).rows,(await pool!.query(query)).rows);
    }assert.deepEqual((await restored.query('SELECT last_value,is_called FROM pozo_id_pozo_seq')).rows,(await pool!.query('SELECT last_value,is_called FROM pozo_id_pozo_seq')).rows);
    await assert.rejects(restored.query('DELETE FROM administracion_eliminacion'),/inmutable/);
    }finally{await restored.end();}
  });
  writeFileSync(path.join(root,'RESULT.json'),JSON.stringify({passed,root,productionTouched:false}));
  console.log(`${passed}/${passed} comprobaciones aprobadas; evidencia ficticia: ${root}`);
} finally {await pool?.end();await myPool.end();if(started)pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
