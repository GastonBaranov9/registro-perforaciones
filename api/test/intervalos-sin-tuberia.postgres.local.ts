// Prueba autónoma: crea su propio contenedor sin volúmenes ni conexión a .env.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { ejecutarMigraciones, leerMigraciones, DIRECTORIO_MIGRACIONES } from '../src/db/migrator.ts';
import type { PozoCompletoBody } from '../src/models/schemas.ts';

test('sin cañería: migración, CRUD, normales, históricos e idempotencia en PostgreSQL descartable', {timeout:180000}, async t => {
  const name='rsp-sin-tuberia-'+randomUUID().slice(0,8);
  const password=randomUUID(), database='prueba_sin_tuberia';
  const root=await mkdtemp(path.join(tmpdir(),'rsp-sin-tuberia-'));
  const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
  let started=false, pool:Pool|undefined, cerrarApp:(()=>Promise<void>)|undefined;
  try {
    docker(['run','--rm','-d','--name',name,'--tmpfs','/var/lib/postgresql/data',
      '-e',`POSTGRES_PASSWORD=${password}`,'-e',`POSTGRES_DB=${database}`,
      '-p','127.0.0.1::5432','postgres:16-alpine']);
    started=true;
    const port=Number(docker(['port',name,'5432/tcp']).split(':').at(-1));
    assert.ok(port>0);
    for(let n=0;;n++) {
      try { docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d',database]);break; }
      catch(e) { if(n>=30)throw e; await new Promise(r=>setTimeout(r,300)); }
    }
    pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database,ssl:false,options:''});
    assert.equal((await pool.query('SELECT current_database() AS nombre')).rows[0].nombre,database);
    const previas=path.join(root,'previas');await mkdir(previas);
    for(const m of (await leerMigraciones()).filter(m=>m.version<'021'))
      await copyFile(path.join(DIRECTORIO_MIGRACIONES,m.archivo),path.join(previas,m.archivo));
    await ejecutarMigraciones(pool,{directorio:previas});
    await pool.query(`INSERT INTO usuario(id_usuario,nombre,email,password) VALUES
      (1,'Admin','admin@local.test','prueba'),(2,'Propietario','prop@local.test','prueba'),(3,'Perforador','perf@local.test','prueba');
      INSERT INTO usuario_rol SELECT 1,id_rol FROM rol WHERE nombre='administracion';
      INSERT INTO usuario_rol SELECT 2,id_rol FROM rol WHERE nombre='propietario';
      INSERT INTO usuario_rol SELECT 3,id_rol FROM rol WHERE nombre='perforador';
      INSERT INTO sitio(departamento) VALUES('Salto');
      UPDATE numeracion_perforacion SET proximo=900000;
      INSERT INTO pozo(id_propietario,id_perforador,id_sitio,profundidad_final_m) VALUES(2,3,1,50);
      INSERT INTO intervalo_diametro_perforacion(id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES(1,0,50,8,NULL);`);
    const antes=(await pool.query('SELECT * FROM intervalo_diametro_perforacion')).rows[0];
    const contador=JSON.stringify((await pool.query('SELECT * FROM numeracion_perforacion')).rows);
    await t.test('021 conserva filas nulas y numeración; restricción material y rerun',async()=>{
      assert.deepEqual((await ejecutarMigraciones(pool!)).aplicadas,['021_intervalos_sin_tuberia.sql']);
      assert.deepEqual((await pool!.query('SELECT * FROM intervalo_diametro_perforacion')).rows[0],{...antes,sin_tuberia:false});
      assert.equal(JSON.stringify((await pool!.query('SELECT * FROM numeracion_perforacion')).rows),contador);
      assert.deepEqual((await ejecutarMigraciones(pool!)).aplicadas,[]);
      await assert.rejects(pool!.query("UPDATE intervalo_diametro_perforacion SET sin_tuberia=true,material_tuberia='PVC'"),{code:'23514'});
    });
    Object.assign(process.env,{NODE_ENV:'test',PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'postgres',PGPASSWORD:password,
      PGDATABASE:database,FOTOS_DIR:path.join(root,'fotos'),FASTIFY_SECRET:'solo-prueba-descartable-sin-tuberia'});
    const {myPool}=await import('../src/db/pool.ts');cerrarApp=()=>myPool.end();
    const {crearPozoCompleto,actualizarPozoCompleto,huellaOffline}=await import('../src/services/pozo-completo-service.ts');
    const {crearHistorico,editarHistorico}=await import('../src/services/historicos-service.ts');
    const {createIntervaloDiametro,updateIntervaloDiametro,listIntervalosDiametroByPozo,getIntervaloDiametroById}=await import('../src/services/intervalo-diametro-services.ts');
    const {crearFiltro,actualizarFiltro}=await import('../src/services/intervalos-filtro-service.ts');
    const {getReportePozo}=await import('../src/services/generar-informe-consultas.ts');
    const abierto={desde_m:20,hasta_m:50,diametro_pulg:8,material_tuberia:null,sin_tuberia:true};
    const cuerpo=():PozoCompletoBody=>({pozo:{id_propietario:2,id_perforador:3,profundidad_final_m:50},
      sitio_nuevo:{departamento:'Salto',latitud:'-31',longitud:'-57'},
      intervalos_litologicos:[{desde_m:0,hasta_m:50,material:'Basalto',id_litologia:1}],
      intervalos_diametro:[{desde_m:0,hasta_m:20,diametro_pulg:8,material_tuberia:'PVC'},abierto],
      intervalos_filtro:[],niveles_aporte:[],sello_sanitario_constructivo:{desde_m:0,hasta_m:10}});
    const tx=async<T>(fn:(db:PoolClient)=>Promise<T>)=>{
      const client=await pool!.connect();
      try {await client.query('BEGIN');const r=await fn(client);await client.query('COMMIT');return r;}
      catch(e){await client.query('ROLLBACK');throw e;} finally {client.release();}
    };
    const leer=async(id:number)=>{
      const filas=await listIntervalosDiametroByPozo(id);
      assert.equal(filas[1].sin_tuberia,true);assert.equal(filas[1].material_tuberia,null);
      assert.equal(Number(filas[1].diametro_pulg),8);
      assert.equal((await getReportePozo(id,pool!))!.diametros[1].sin_tuberia,true);
      return filas;
    };
    const normal=await crearPozoCompleto(3,cuerpo(),path.join(root,'fotos'),pool);
    await t.test('alta normal, lectura de informe y reemplazo completo conservan el estado',async()=>{
      await leer(normal.pozo.id_pozo);
      const r=await actualizarPozoCompleto(normal.pozo.id_pozo,{
        pozo:{...cuerpo().pozo,id_sitio:normal.sitio.id_sitio},foto_accion:'conservar',
        intervalos_litologicos:normal.intervalos_litologicos,intervalos_diametro:cuerpo().intervalos_diametro,
        intervalos_filtro:[],niveles_aporte:[]},path.join(root,'fotos'),pool);
      assert.equal(r.intervalos_diametro[1].sin_tuberia,true);await leer(normal.pozo.id_pozo);
    });
    const epoca=(await pool.query('SELECT epoca FROM epoca_datos')).rows[0].epoca;
    await t.test('alta y edición histórica conservan también los intervalos no enviados',async()=>{
      const h=await crearHistorico(1,{numero_perforacion:2100,profundidad_final_m:50,intervalos_diametro:cuerpo().intervalos_diametro},randomUUID(),epoca,pool!);
      await leer(h.id_pozo);
      await editarHistorico(1,h.id_pozo,{empresa:'Edición',niveles_aporte:[{profundidad_m:30}]},pool!);
      await leer(h.id_pozo);
      await editarHistorico(1,h.id_pozo,{intervalos_diametro:cuerpo().intervalos_diametro},pool!);
      await leer(h.id_pozo);
    });
    await t.test('CRUD individual cambia PVC ↔ abierto; filtros y tramos abiertos se rechazan mutuamente',async()=>{
      const filas=await leer(normal.pozo.id_pozo),id=Number(filas[1].id_intervalo_diametro_perforacion);
      const tubo={...abierto,sin_tuberia:false,material_tuberia:'Acero' as const};
      await tx(db=>updateIntervaloDiametro(normal.pozo.id_pozo,id,tubo,db));
      assert.equal((await getIntervaloDiametroById(normal.pozo.id_pozo,id))!.sin_tuberia,false);
      await tx(db=>updateIntervaloDiametro(normal.pozo.id_pozo,id,abierto,db));
      const filtro={desde_m:25,hasta_m:30,diametro_pulg:8,material_tuberia:'PVC' as const,ranura_mm:0.5 as const};
      await assert.rejects(tx(db=>crearFiltro(normal.pozo.id_pozo,filtro,db)),/no puede solaparse/);
      const f=await tx(db=>crearFiltro(normal.pozo.id_pozo,{...filtro,desde_m:5,hasta_m:10},db));
      await assert.rejects(tx(db=>actualizarFiltro(normal.pozo.id_pozo,f.id_intervalo_filtro,filtro,db)),/no puede solaparse/);
      await assert.rejects(tx(db=>updateIntervaloDiametro(normal.pozo.id_pozo,Number(filas[0].id_intervalo_diametro_perforacion),{...abierto,desde_m:0,hasta_m:20},db)),/no puede solaparse/);
      await tx(db=>db.query('DELETE FROM intervalo_diametro_perforacion WHERE id_intervalo_diametro_perforacion=$1',[id]));
      await tx(db=>createIntervaloDiametro(normal.pozo.id_pozo,abierto,db));await leer(normal.pozo.id_pozo);
    });
    await t.test('hash y reintentos offline antiguos y nuevos no duplican ni cambian el cuerpo',async()=>{
      for(const nuevo of [false,true]){
        const b=cuerpo(); b.pozo={...b.pozo,id_propietario:null,propietario_provisional:'Persona local'};
        if(!nuevo)b.intervalos_diametro=[{desde_m:0,hasta_m:50,diametro_pulg:8,material_tuberia:'PVC'}];
        const key=randomUUID(),hash=huellaOffline(b),json=JSON.stringify(b);
        const a=await crearPozoCompleto(3,b,path.join(root,'fotos'),pool!,key,epoca);
        const repetido=await crearPozoCompleto(3,JSON.parse(json),path.join(root,'fotos'),pool!,key,epoca);
        assert.equal(repetido.pozo.id_pozo,a.pozo.id_pozo);
        assert.equal(huellaOffline(b),hash);
        assert.equal((await pool!.query('SELECT huella FROM creacion_offline WHERE clave=$1',[key])).rows[0].huella,hash);
        if(nuevo)await leer(a.pozo.id_pozo);
        else assert.equal(Object.hasOwn(b.intervalos_diametro[0],'sin_tuberia'),false);
      }
    });
    await t.test('null legado sigue siendo material no especificado en el informe',async()=>{
      const r=await getReportePozo(1,pool!);assert.equal(r!.diametros[0].material_tuberia,null);assert.equal(r!.diametros[0].sin_tuberia,false);
    });
  } finally {
    await cerrarApp?.();await pool?.end();
    if(started)docker(['stop',name]);
    const target=await realpath(root),temp=await realpath(tmpdir());
    assert.ok(target.toLowerCase().startsWith((temp+path.sep+'rsp-sin-tuberia-').toLowerCase()));
    await rm(target,{recursive:true,force:true});
  }
});
