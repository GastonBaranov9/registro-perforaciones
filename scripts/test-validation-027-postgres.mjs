// Operational gate only. Fresh PostgreSQL in Temp or an isolated --docker16 lab; no .env.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,readdirSync,copyFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ejecutarMigraciones} from '../api/src/db/migrator.ts';
const {Pool}=createRequire(new URL('../api/package.json',import.meta.url))('pg');
const repo=fileURLToPath(new URL('../',import.meta.url));
const root=mkdtempSync(path.join(tmpdir(),'rsp-gate027-pg-')),data=path.join(root,'data');
const bin=process.env.RSP_PREFILTRO_PG_BIN??'C:/Program Files/PostgreSQL/18/bin',password=randomBytes(24).toString('hex');
const env={...process.env};for(const k of Object.keys(env))if(/^(PG|POSTGRES_)/i.test(k))delete env[k];
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
let port=listener.address().port;await new Promise((r,j)=>listener.close(e=>e?j(e):r()));
function pg(name,args){return execFileSync(path.join(bin,name+'.exe'),args,{env:{...env,PGPASSWORD:password},windowsHide:true,timeout:60000,stdio:name==='pg_ctl'?'ignore':'pipe'});}
const docker16=process.argv.includes('--docker16');
const containerName='rsp-gate027-lab-'+randomUUID();
const docker=(args)=>execFileSync('docker',args,{env:{...env,POSTGRES_PASSWORD:password},encoding:'utf8',windowsHide:true,timeout:60000}).trim();
let started=false,pool,checks=0,containerId;
try{
  if(docker16){
    const image=readFileSync(path.join(repo,'docker-compose.production.yaml'),'utf8').match(/image:\s*(postgres:16[^\s]+@sha256:[a-f0-9]{64})/)[1];
    // Fresh anonymous volume, random loopback port, no production paths/networks.
    containerId=docker(['run','--detach','--rm','--pull=never','--name',containerName,'--label','com.docker.compose.project=rsp-gate027-lab','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD',image]);
    assert.match(containerId,/^[a-f0-9]{64}$/);
    port=Number(docker(['port',containerId,'5432/tcp']).match(/^127\.0\.0\.1:(\d+)$/)[1]);
  }else{
    const pw=path.join(root,'password');writeFileSync(pw,password);
    pg('initdb',['-D',data,'-U','postgres','--auth=scram-sha-256','--pwfile='+pw,'--encoding=UTF8','--locale=C']);unlinkSync(pw);
    started=true;pg('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o','-h 127.0.0.1 -p '+port+' -c shared_buffers=16MB -c max_connections=10','-w','start']);
  }
  pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',max:1});
  if(docker16){
    let ready=false;for(let attempt=0;attempt<80;attempt++){try{await pool.query('SELECT 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}
    assert.ok(ready);
    const inspected=JSON.parse(docker(['inspect',containerId]))[0];
    assert.equal(inspected.Name,'/'+containerName);assert.equal(inspected.Config.Labels['com.docker.compose.project'],'rsp-gate027-lab');
    assert.equal((await pool.query('SHOW data_directory')).rows[0].data_directory,'/var/lib/postgresql/data');
    assert.match((await pool.query('SHOW server_version')).rows[0].server_version,/^16\./);
  }else assert.equal(path.resolve((await pool.query('SHOW data_directory')).rows[0].data_directory).toLowerCase(),path.resolve(data).toLowerCase());
  checks++;
  const migrations=path.join(repo,'api/db/migrations'),old=path.join(root,'migrations026');mkdirSync(old);
  for(const f of readdirSync(migrations).filter(f=>/^\d{3}_.+\.sql$/.test(f)&&f.slice(0,3)<='026'))copyFileSync(path.join(migrations,f),path.join(old,f));
  await ejecutarMigraciones(pool,{directorio:old,logger:()=>{}});
  await pool.query("INSERT INTO usuario(id_usuario,nombre,email,password,cuenta_acceso) VALUES(1,'Synthetic','fixture@example.test','no-login',true); INSERT INTO usuario_rol SELECT 1,id_rol FROM rol WHERE nombre='administracion'; INSERT INTO pozo(origen,creado_por,profundidad_final_m,pre_filtro) VALUES('historico',1,30,'Texto sintetico legado'); INSERT INTO sello_sanitario_pozo VALUES(1,0,10); UPDATE politica_numeracion SET rangos='[{\"desde\":20,\"hasta\":200}]',excepciones=ARRAY[50];");
  const sql=readFileSync(path.join(repo,'ops/validation-027.sql'),'utf8');
  async function snapshot(name){
    const c=await pool.connect();
    try{
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      assert.equal((await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');
      const result=(await c.query(sql)).rows[0].json_build_object;
      writeFileSync(path.join(root,name+'.json'),JSON.stringify(result));return result;
    }finally{await c.query('ROLLBACK');c.release();}
  }
  const before=await snapshot('before');
  assert.deepEqual((await ejecutarMigraciones(pool,{directorio:migrations,logger:()=>{}})).aplicadas,['027_prefiltro_constructivo.sql']);checks++;
  const after=await snapshot('after');
  assert.deepEqual(before.data,after.data);assert.deepEqual(before.schema,after.schema);checks++;
  assert.equal(after.prefiltro_rows,0);checks++;
  await pool.query('UPDATE usuario SET version_sesion=version_sesion+1 WHERE id_usuario=1');
  await snapshot('smoke');
  // Real catalog mutations are rolled back and must all be rejected by the gate.
  const mutations=[
    ['bad-depth','ALTER TABLE prefiltro_pozo DROP CONSTRAINT prefiltro_pozo_check'],
    ['bad-fk','ALTER TABLE prefiltro_pozo DROP CONSTRAINT prefiltro_pozo_id_pozo_fkey'],
    ['bad-null','ALTER TABLE prefiltro_pozo ALTER COLUMN hasta_m DROP NOT NULL'],
    ['invented','INSERT INTO prefiltro_pozo VALUES(1,12,15)'],
    ['changed-legacy',"UPDATE pozo SET pre_filtro='changed' WHERE id_pozo=1"],
    ['changed-policy',"UPDATE politica_numeracion SET excepciones='{}'"],
    ['changed-schema','ALTER TABLE pozo ADD COLUMN invalid_027 text'],
  ];
  for(const [name,mutation] of mutations){
    await pool.query('BEGIN');
    try{
      await pool.query(mutation);
      const result=(await pool.query(sql)).rows[0].json_build_object;
      writeFileSync(path.join(root,name+'.json'),JSON.stringify(result));
    }finally{await pool.query('ROLLBACK');}
  }
  const output=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(repo,'scripts/test-validation-027.ps1'),'-SnapshotDirectory',root],{env,encoding:'utf8',windowsHide:true,timeout:60000});
  process.stdout.write(output);assert.match(output,/VALIDATION_027_OK/);
  console.log('GATE_027_SQL_OK '+checks+'/'+checks+'; real read-only snapshots, synthetic catalog failure cases');
}finally{
  await pool?.end();if(started)pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  if(containerId){
    const inspected=JSON.parse(docker(['inspect',containerId]))[0];
    assert.equal(inspected.Name,'/'+containerName);assert.equal(inspected.Config.Labels['com.docker.compose.project'],'rsp-gate027-lab');
    docker(['stop',containerId]); // --rm removes only this disposable container/anonymous volume.
  }
  console.log('Isolated cluster stopped; evidence: '+root);
}
