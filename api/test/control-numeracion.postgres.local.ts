// PostgreSQL nuevo en Temp. Sin .env, Docker, redes ni datos productivos.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,unlinkSync,mkdirSync,readFileSync,readdirSync,copyFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Pool} from 'pg';
import Fastify from 'fastify';
import {ejecutarMigraciones} from '../src/db/migrator.ts';
process.env.NODE_ENV='test';for(const k of Object.keys(process.env))if(/^(PG|POSTGRES_)/i.test(k))delete process.env[k];
const root=mkdtempSync(path.join(tmpdir(),'rsp-control-numeracion-pg-')),data=path.join(root,'data'),fotos=path.join(root,'persistencia','fotos');mkdirSync(fotos,{recursive:true});process.env.FOTOS_DIR=fotos;
const {crearHistorico}=await import('../src/services/historicos-service.ts');
const {consultarReingreso}=await import('../src/services/reingreso-historico-service.ts');
const {consultarEliminacion,ejecutarEliminacion}=await import('../src/services/administracion-eliminaciones-service.ts');
const {configurarNumeracion}=await import('../src/services/numeracion-perforacion-service.ts');
const {previsualizarRectificacion,rectificarNumeracion}=await import('../src/services/rectificacion-numeracion-service.ts');
const {myPool}=await import('../src/db/pool.ts');
const {T05SinPermiso}=await import('../src/models/errors.ts');
const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const addr=listener.address();assert.ok(addr&&typeof addr==='object');const port=addr.port;await new Promise<void>((r,j)=>listener.close(e=>e?j(e):r()));
const password=randomBytes(24).toString('hex'),bin='C:/Program Files/PostgreSQL/18/bin';
function pg(name:string,args:string[]){return execFileSync(path.join(bin,name+'.exe'),args,{env:{...process.env,PGPASSWORD:password},windowsHide:true,timeout:60000,encoding:'utf8',stdio:name==='pg_ctl'?'ignore':['pipe','pipe','pipe']});}
let started=false,pool:Pool|undefined,passed=0;
async function check(name:string,fn:()=>Promise<void>){await fn();passed++;console.log('PASS '+name);}
try{
 const pw=path.join(root,'password');writeFileSync(pw,password);pg('initdb',['-D',data,'-U','postgres','--auth=scram-sha-256','--pwfile='+pw,'--encoding=UTF8','--locale=C']);unlinkSync(pw);
 started=true;pg('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=15`,'-w','start']);
 pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',max:6});
 assert.equal(path.resolve((await pool.query('SHOW data_directory')).rows[0].data_directory).toLowerCase(),path.resolve(data).toLowerCase());
 const anteriores=path.join(root,'schema024');mkdirSync(anteriores);for(const f of readdirSync('db/migrations').filter(f=>/^\d{3}_.*\.sql$/.test(f)&&f.slice(0,3)<='024'))copyFileSync('db/migrations/'+f,path.join(anteriores,f));
 await ejecutarMigraciones(pool,{directorio:anteriores,logger:()=>{}});
 await pool.query(`INSERT INTO usuario(id_usuario,nombre,email,password,cuenta_acceso) VALUES(1,'Admin','admin@example.test','no-login',true),(2,'Perforador','p@example.test','no-login',true),(3,'Propietario',NULL,NULL,false),(4,'Otro admin','otro@example.test','no-login',true);
 INSERT INTO usuario_rol SELECT u,r.id_rol FROM (VALUES(1),(4))v(u),rol r WHERE r.nombre='administracion'; INSERT INTO usuario_rol SELECT 2,id_rol FROM rol WHERE nombre='perforador';
 INSERT INTO sitio(departamento) VALUES('Salto'); INSERT INTO pozo(origen,numero_perforacion,creado_por) VALUES('historico',3281,1); UPDATE numeracion_perforacion SET proximo=32823;`);
 const {revisarConfiguracion,historialNumeracion}=await import('../src/services/numeracion-perforacion-service.ts');
 const {crearPozoCompleto}=await import('../src/services/pozo-completo-service.ts');
 const estado=async()=> (await pool!.query('SELECT to_jsonb(n) s FROM numeracion_perforacion n')).rows[0].s;
 const reservas=async()=> (await pool!.query('SELECT coalesce(jsonb_agg(r ORDER BY numero_perforacion),\'[]\') s FROM numero_perforacion_reservado r')).rows[0].s;
 const original=await estado();
 await check('024 a 025 sólo estructura: contador y reservas intactos, sin concesiones',async()=>{assert.deepEqual((await ejecutarMigraciones(pool!,{logger:()=>{}})).aplicadas,['025_control_administrativo_numeracion.sql']);assert.deepEqual(await estado(),original);assert.equal((await pool!.query('SELECT count(*) FROM autorizacion_numeracion')).rows[0].count,'0');});
 const privilegio=async(conceder:boolean,actor=1,destinatario=1,revision?:number)=>{
  const r=revision??Number((await pool!.query('SELECT revision FROM autorizacion_numeracion WHERE usuario=$1',[destinatario])).rows[0]?.revision??0);
  return pool!.query('SELECT administrar_autorizacion_numeracion($1,$2,$3,$4,$5,$6)',[destinatario,actor,conceder,'Gestion ficticia de capacidad administrativa',r,`${conceder?'CONCEDER':'REVOCAR'} ${destinatario}`]);
 };
 await check('concesión explícita auditada, sin acceso PUBLIC ni DML sin contexto',async()=>{
  await assert.rejects(pool!.query("INSERT INTO autorizacion_numeracion(usuario,concedido_por,motivo) VALUES(1,1,'Sin procedimiento autorizado')"));
  await assert.rejects(privilegio(true,2));await assert.rejects(privilegio(true,1,2));
  await privilegio(true);await assert.rejects(privilegio(true));
  assert.equal((await pool!.query('SELECT count(*) FROM autorizacion_numeracion_historial')).rows[0].count,'1');
  await pool!.query('CREATE ROLE operador_sin_permiso');
  assert.equal((await pool!.query("SELECT has_function_privilege('operador_sin_permiso','administrar_autorizacion_numeracion(bigint,bigint,boolean,text,bigint,text)','EXECUTE') ok")).rows[0].ok,false);
 });
 await check('revocación/reconcesión auditadas, revisión concurrente y rollback de auditoría',async()=>{
  const antes=(await pool!.query('SELECT to_jsonb(a) s FROM autorizacion_numeracion a')).rows[0].s;
  await pool!.query("CREATE FUNCTION fallo_privilegio() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo-privilegio'; END $$; CREATE TRIGGER fallo_privilegio BEFORE INSERT ON autorizacion_numeracion_historial FOR EACH ROW EXECUTE FUNCTION fallo_privilegio()");
  await assert.rejects(privilegio(false),/fallo-privilegio/);
  assert.deepEqual((await pool!.query('SELECT to_jsonb(a) s FROM autorizacion_numeracion a')).rows[0].s,antes);
  await pool!.query('DROP TRIGGER fallo_privilegio ON autorizacion_numeracion_historial');
  const r=Number(antes.revision),rs=await Promise.allSettled([privilegio(false,1,1,r),privilegio(false,1,1,r)]);
  assert.equal(rs.filter(x=>x.status==='fulfilled').length,1);
  await privilegio(true);
  assert.equal(Number((await pool!.query('SELECT revision FROM autorizacion_numeracion')).rows[0].revision),r+2);
  for(const op of ['UPDATE autorizacion_numeracion_historial SET motivo=motivo','DELETE FROM autorizacion_numeracion_historial','TRUNCATE autorizacion_numeracion_historial','DELETE FROM autorizacion_numeracion','TRUNCATE autorizacion_numeracion CASCADE'])await assert.rejects(pool!.query(op),/inmutable/);
 });
 const motivo='Correccion administrativa ficticia documentada';
 const solicitud=async(actor:number,n:number)=>{const v=await revisarConfiguracion(actor,n,motivo,pool!);return {v,c:{token:v.token!,confirmacion:`CONFIRMAR ${n}`,registros_fisicos_confirmados:true}};};
 const aplicar=async(actor:number,n:number)=>{const {v,c}=await solicitud(actor,n);return configurarNumeracion(actor,n,v.anterior,motivo,pool!,c);};
 await check('corregir error 32823 a 3282 sin modificar reservas ni mayor asignado',async()=>{const r=await reservas();await aplicar(1,3282);assert.equal((await estado()).proximo,3282);assert.equal((await estado()).mayor_asignado,3281);assert.deepEqual(await reservas(),r);});
 await check('adelanto 3282 a 32823 con advertencia y vuelta a 3282',async()=>{assert.equal((await solicitud(1,32823)).v.salto_grande,true);await aplicar(1,32823);await aplicar(1,3282);});
 await check('administrador sin privilegio sólo adelanta; perforador y cuenta deshabilitada rechazados',async()=>{await aplicar(4,3290);assert.equal((await solicitud(4,3282)).v.token,null);await assert.rejects(aplicar(4,3282),{statusCode:409});await assert.rejects(solicitud(2,3300),{statusCode:403});await pool!.query('UPDATE usuario SET activo=false WHERE id_usuario=1');await assert.rejects(solicitud(1,3282),{statusCode:403});await pool!.query('UPDATE usuario SET activo=true WHERE id_usuario=1');await aplicar(1,3282);});
 await check('consulta, cancelación y mismo valor no cambian ni auditan',async()=>{const before=await estado(),n=(await pool!.query('SELECT count(*) FROM numeracion_perforacion_configuracion')).rows[0].count;await solicitud(1,3290);assert.equal((await solicitud(1,3282)).v.token,null);await assert.rejects(aplicar(1,3282));assert.deepEqual(await estado(),before);assert.equal((await pool!.query('SELECT count(*) FROM numeracion_perforacion_configuracion')).rows[0].count,n);});
 await check('motivo, frase, declaración y firma obligatorios; cliente antiguo rechazado',async()=>{const {v,c}=await solicitud(1,3290);await assert.rejects(revisarConfiguracion(1,3290,'',pool!),{statusCode:400});for(const x of [undefined,{...c,confirmacion:'CONFIRMAR 3282'},{...c,registros_fisicos_confirmados:false},{...c,token:c.token+'x'}])await assert.rejects(configurarNumeracion(1,3290,v.anterior,motivo,pool!,x));});
 await check('desafío vencido, otro actor, revocación y reconcesión impiden reutilizar confirmación',async()=>{const {v,c}=await solicitud(1,3283);const now=Date.now;try{Date.now=()=>now()+301000;await assert.rejects(configurarNumeracion(1,3283,v.anterior,motivo,pool!,c));}finally{Date.now=now;}await assert.rejects(configurarNumeracion(4,3283,v.anterior,motivo,pool!,c));await privilegio(false);await assert.rejects(configurarNumeracion(1,3283,v.anterior,motivo,pool!,c));await privilegio(true);await assert.rejects(configurarNumeracion(1,3283,v.anterior,motivo,pool!,c));});
 await check('dos configuraciones concurrentes sólo una confirma; desafío consumido no sirve',async()=>{const {v,c}=await solicitud(1,3283);const rs=await Promise.allSettled([configurarNumeracion(1,3283,v.anterior,motivo,pool!,c),configurarNumeracion(1,3283,v.anterior,motivo,pool!,c)]);assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);await assert.rejects(configurarNumeracion(1,3283,v.anterior,motivo,pool!,c));await aplicar(1,3282);await assert.rejects(configurarNumeracion(1,3283,v.anterior,motivo,pool!,c));});
 await check('fallo de auditoría revierte por completo configuración',async()=>{await pool!.query("CREATE FUNCTION fallo_config() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo-config'; END $$; CREATE TRIGGER fallo_config BEFORE INSERT ON numeracion_perforacion_configuracion FOR EACH ROW EXECUTE FUNCTION fallo_config()");const b=await estado();await assert.rejects(aplicar(1,3290),/fallo-config/);assert.deepEqual(await estado(),b);await pool!.query('DROP TRIGGER fallo_config ON numeracion_perforacion_configuracion');});
 const alta=async()=> (await pool!.query('INSERT INTO pozo(id_propietario,id_perforador,id_sitio) VALUES(3,2,1) RETURNING id_pozo,numero_perforacion')).rows[0];
 await check('número corregido se asigna exactamente y avanza',async()=>{assert.equal((await alta()).numero_perforacion,3282);assert.equal((await estado()).proximo,3283);});
 await check('rechaza activo, reserva eliminada y referencia huérfana',async()=>{await pool!.query("INSERT INTO pozo(numero_perforacion,id_propietario,id_perforador,id_sitio) VALUES(3284,3,2,1); DELETE FROM pozo WHERE numero_perforacion=3284");const ep=(await pool!.query('SELECT epoca FROM epoca_datos')).rows[0].epoca;await pool!.query("INSERT INTO creacion_offline(actor,clave,epoca,huella,resultado) VALUES(1,$1,$2,repeat('a',64),$3)",[randomUUID(),ep,{pozo:{id_pozo:900,numero_perforacion:3285}}]);for(const n of [3282,3284,3285]){assert.equal((await solicitud(1,n)).v.token,null);await assert.rejects(aplicar(1,n));}});
 await check('cursor por debajo del máximo; avance saltea reserva y referencia sin liberarlas',async()=>{await aplicar(1,3400);assert.equal((await alta()).numero_perforacion,3400);await aplicar(1,3283);const r=await reservas();assert.equal((await alta()).numero_perforacion,3283);assert.equal((await estado()).proximo,3286);assert.equal((await estado()).mayor_asignado,3400);assert.ok((await reservas()).some((x:any)=>x.numero_perforacion===3284));assert.equal((await reservas()).length,r.length+1);});
 await check('altas simultáneas reciben números únicos',async()=>{const rs=await Promise.all([alta(),alta(),alta()]);assert.deepEqual(rs.map(r=>r.numero_perforacion).sort(),[3286,3287,3288]);});
 await check('nuevo conflicto después de vista previa invalida confirmación',async()=>{const {v,c}=await solicitud(1,3500);await pool!.query("INSERT INTO pozo(numero_perforacion,id_propietario,id_perforador,id_sitio) VALUES(3500,3,2,1)");await assert.rejects(configurarNumeracion(1,3500,v.anterior,motivo,pool!,c));});
 await check('histórico y reingreso conservan cursor y referencia original',async()=>{const before=await estado(),ep=(await pool!.query('SELECT epoca FROM epoca_datos')).rows[0].epoca,key=randomUUID();const x=await crearHistorico(1,{numero_perforacion:3277},key,ep,pool!);await pool!.query('DELETE FROM pozo WHERE id_pozo=$1',[x.id_pozo]);const ref=(await pool!.query('SELECT to_jsonb(c) s FROM creacion_historica c WHERE clave=$1',[key])).rows[0].s;const v=await consultarReingreso(1,3277,pool!);const y=await crearHistorico(1,{numero_perforacion:3277,reingreso:{token:v.token!,motivo,confirmacion:'REINGRESAR 3277',sin_referencias_externas:true,nueva_carga_administrativa:true}},randomUUID(),ep,pool!);assert.notEqual(x.id_pozo,y.id_pozo);assert.deepEqual(await estado(),before);assert.deepEqual((await pool!.query('SELECT to_jsonb(c) s FROM creacion_historica c WHERE clave=$1',[key])).rows[0].s,ref);});
 await check('auditoría inmutable, motivo y autorización registrados; historial sólo lectura',async()=>{const h=await historialNumeracion(1,undefined,pool!);assert.ok(h.length);for(const op of ['UPDATE numeracion_perforacion_configuracion SET motivo=motivo','DELETE FROM numeracion_perforacion_configuracion','TRUNCATE numeracion_perforacion_configuracion'])await assert.rejects(pool!.query(op),/inmutable/);const a=(await pool!.query("SELECT * FROM numeracion_perforacion_configuracion WHERE tipo='retroceso' LIMIT 1")).rows[0];assert.ok(a.nonce&&a.autorizacion_id&&a.estado_verificado&&a.confirmacion);await assert.rejects(historialNumeracion(2,undefined,pool!),{statusCode:403});});
 await check('SQL no puede apuntar a número ocupado ni cambiar un número asignado',async()=>{await assert.rejects(pool!.query('UPDATE numeracion_perforacion SET proximo=3282'));await assert.rejects(pool!.query('UPDATE pozo SET numero_perforacion=3600 WHERE numero_perforacion=3282'));});
 await check('offline concurrente e idempotencia conservan una asignación y fotografía',async()=>{
  const ep=(await pool!.query('SELECT epoca FROM epoca_datos')).rows[0].epoca,key=randomUUID();
  const data={pozo:{id_propietario:null,propietario_provisional:"Persona ficticia",id_perforador:2,profundidad_final_m:30},sitio_nuevo:{departamento:'Salto',localidad:'Campo',latitud:'-31',longitud:'-57'},intervalos_litologicos:[],intervalos_diametro:[],intervalos_filtro:[],niveles_aporte:[],foto:{mime_type:'image/png' as const,base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}};
  const before=await estado();const [a,b]=await Promise.all([crearPozoCompleto(2,data,fotos,pool!,key,ep),crearPozoCompleto(2,data,fotos,pool!,key,ep)]);assert.equal(a.pozo.id_pozo,b.pozo.id_pozo);assert.equal(a.pozo.numero_perforacion,before.proximo);assert.equal((await estado()).proximo,before.proximo+1);
 });
 await check('HTTP antiguo no puede configurar ni borrar; vista previa no escribe',async()=>{
  const q=myPool.query,c=myPool.connect;myPool.query=pool!.query.bind(pool);myPool.connect=pool!.connect.bind(pool);const app=Fastify();
  app.decorate('authenticate',async req=>{req.user={sub:1} as typeof req.user;});app.decorate('userIsAdmin',async()=>{});
  for(const name of ['puedeGestionarHistoricos','puedeOperarTodosLosPozos','puedeOperarPozos','pozoIsFromUser','puedeConsultarRecursos','userIsSelf'])app.decorate(name,async()=>{});app.decorate('notifyClient',()=>{});
  try{await app.register((await import('../src/routes/numeracion-perforacion.ts')).default);await app.register((await import('../src/routes/pozos.ts')).default);const b=await estado();assert.equal((await app.inject({method:'PUT',url:'/pozos/numeracion',payload:{proximo:4000,esperado:b.proximo,motivo}})).statusCode,400);assert.equal((await app.inject({method:'DELETE',url:'/usuarios/1/pozos/1'})).statusCode,400);assert.equal((await app.inject({method:'POST',url:'/pozos/numeracion/revision',payload:{proximo:4000,motivo}})).statusCode,200);assert.deepEqual(await estado(),b);}finally{await app.close();myPool.query=q;myPool.connect=c;}
 });
 await check('backup y restore conservan esquema, datos, auditoría, privilegio y secuencias',async()=>{const args=['-h','127.0.0.1','-p',String(port),'-U','postgres'],dump=path.join(root,'database.dump');pg('pg_dump',[...args,'-Fc','-f',dump,'postgres']);pg('pg_restore',['--list',dump]);await pool!.query('CREATE DATABASE restauracion_aislada');pg('pg_restore',[...args,'--exit-on-error','--dbname=restauracion_aislada',dump]);const restored=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'restauracion_aislada'});try{for(const {tablename} of (await pool!.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows){const q=`SELECT to_jsonb(t) s FROM ${tablename} t ORDER BY to_jsonb(t)::text`;assert.deepEqual((await restored.query(q)).rows,(await pool!.query(q)).rows);}assert.deepEqual((await restored.query('SELECT last_value,is_called FROM pozo_id_pozo_seq')).rows,(await pool!.query('SELECT last_value,is_called FROM pozo_id_pozo_seq')).rows);await assert.rejects(restored.query('DELETE FROM numeracion_perforacion_configuracion'),/inmutable/);}finally{await restored.end();}});
 writeFileSync(path.join(root,'RESULT.json'),JSON.stringify({passed,productionTouched:false,restored:true}));console.log(`${passed}/${passed} aprobadas; ${root}`);
}finally{await pool?.end();await myPool.end();if(started)pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);}
