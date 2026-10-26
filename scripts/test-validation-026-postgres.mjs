// Only the new operational snapshot/policy queries on synthetic 025 -> 026 data.
// Fresh native PostgreSQL cluster in Temp; never loads .env or contacts Docker.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, copyFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ejecutarMigraciones} from '../api/src/db/migrator.ts';
const {Pool}=createRequire(new URL('../api/package.json',import.meta.url))('pg');
const repo=fileURLToPath(new URL('../',import.meta.url));
const root=mkdtempSync(path.join(tmpdir(),'rsp-gate026-pg-')),data=path.join(root,'data');
const bin='C:/Program Files/PostgreSQL/18/bin',password=randomBytes(24).toString('hex');
const env={...process.env};for(const k of Object.keys(env))if(/^(PG|POSTGRES_)/i.test(k))delete env[k];
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
const port=listener.address().port;await new Promise((r,j)=>listener.close(e=>e?j(e):r()));
function pg(name,args){return execFileSync(path.join(bin,name+'.exe'),args,{env:{...env,PGPASSWORD:password},windowsHide:true,timeout:60000,stdio:name==='pg_ctl'?'ignore':['pipe','pipe','pipe']});}
let started=false,pool;
try{
  const pw=path.join(root,'password');writeFileSync(pw,password);
  pg('initdb',['-D',data,'-U','postgres','--auth=scram-sha-256','--pwfile='+pw,'--encoding=UTF8','--locale=C']);unlinkSync(pw);
  started=true;pg('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=10`,'-w','start']);
  pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',max:1});
  assert.equal(path.resolve((await pool.query('SHOW data_directory')).rows[0].data_directory).toLowerCase(),path.resolve(data).toLowerCase());
  const migrations=path.join(repo,'api/db/migrations'),old=path.join(root,'migrations025');mkdirSync(old);
  for(const f of readdirSync(migrations).filter(f=>/^\d{3}_.+\.sql$/.test(f)&&f.slice(0,3)<='025'))copyFileSync(path.join(migrations,f),path.join(old,f));
  await ejecutarMigraciones(pool,{directorio:old,logger:()=>{}});
  // Synthetic evidence only. No real well, photograph, customer or production dump.
  await pool.query(`
    INSERT INTO usuario(id_usuario,nombre,email,password,cuenta_acceso) VALUES(1,'Fixture','fixture@example.test','no-login',true);
    INSERT INTO usuario_rol SELECT 1,id_rol FROM rol WHERE nombre='administracion';
    UPDATE numeracion_perforacion SET proximo=3282,mayor_asignado=3281;
    SELECT administrar_autorizacion_numeracion(1,1,true,'Privilegio ficticio para barrera 026',0,'CONCEDER 1');
    INSERT INTO numero_perforacion_reservado(numero_perforacion,id_pozo_original) VALUES(3277,31);
    INSERT INTO creacion_historica(actor,clave,epoca,huella,resultado)
      SELECT 1,gen_random_uuid(),epoca,repeat('a',64),jsonb_build_object('id_pozo',n,'numero_perforacion',3277,'origen','historico') FROM epoca_datos CROSS JOIN (VALUES(19),(29),(31)) v(n);
    INSERT INTO reingreso_historico(nonce,actor,clave,numero_perforacion,id_original,id_nuevo,motivo,confirmacion,sin_referencias_externas,nueva_carga_administrativa,anterior,reserva_nueva)
      SELECT gen_random_uuid(),1,gen_random_uuid(),3277,a,b,'Auditoria ficticia para barrera','REINGRESAR 3277',true,true,'{}','{}' FROM (VALUES(19,29),(29,31)) v(a,b);
    INSERT INTO administracion_eliminacion(nonce,actor,operacion,id_pozo_original,numero_perforacion,motivo,prueba_confirmada,sin_referencias_externas,anterior,posterior)
      VALUES(gen_random_uuid(),1,'eliminar',31,3277,'Auditoria ficticia para barrera',false,false,'{}','{}');
  `);
  const snapshotSql=readFileSync(path.join(repo,'ops/validation-026.sql'),'utf8');
  const helper=readFileSync(path.join(repo,'ops/validation-026.ps1'),'utf8');
  const policySql=helper.match(/function Get-Rsp026Policy[^]*?@'\r?\n([^]*?)\r?\n'@/)[1];
  async function snapshot(sql,name){
    const c=await pool.connect();
    try{
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      assert.equal((await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');
      const result=(await c.query(sql)).rows[0].json_build_object;
      writeFileSync(path.join(root,name+'.json'),JSON.stringify(result));
      return result;
    }finally{await c.query('ROLLBACK');c.release();}
  }
  const before=await snapshot(snapshotSql,'before');
  assert.deepEqual((await ejecutarMigraciones(pool,{directorio:migrations,logger:()=>{}})).aplicadas,['026_numeracion_empresarial_configurable.sql']);
  const after=await snapshot(snapshotSql,'after');await snapshot(policySql,'policy');
  assert.deepEqual(before.protected,after.protected);
  const output=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(repo,'scripts/test-validation-026.ps1'),'-SnapshotDirectory',root],{env,encoding:'utf8',windowsHide:true,timeout:60000});
  assert.match(output,/VALIDATION_026_OK 48\/48/);process.stdout.write(output);
  console.log('GATE_026_SQL_OK: actual read-only queries, synthetic 025/026, production untouched');
}finally{
  await pool?.end();
  if(started)pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  console.log('Isolated cluster stopped; synthetic evidence: '+root);
}
