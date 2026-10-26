// Clúster nuevo en Temp, puerto aleatorio y datos sintéticos. No carga .env.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, unlinkSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { ejecutarMigraciones, leerMigraciones, DIRECTORIO_MIGRACIONES } from '../src/db/migrator.ts';
import type { PozoCompletoBody, PozoCompletoUpdateBody } from '../src/models/schemas.ts';

test('027: persistencia real aislada, conservación, idempotencia y restauración', async t => {
  const root=mkdtempSync(path.join(tmpdir(),'rsp-prefiltro027-')),data=path.join(root,'data');
  const bin=process.env.RSP_PREFILTRO_PG_BIN ?? 'C:/Program Files/PostgreSQL/18/bin';
  const password=randomBytes(24).toString('hex');
  const env={...process.env};for(const k of Object.keys(env))if(/^(PG|POSTGRES_)/i.test(k))delete env[k];
  const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));
  const address=listener.address();assert.ok(address&&typeof address==='object');const port=address.port;
  await new Promise<void>((r,j)=>listener.close(e=>e?j(e):r()));
  const pg=(name:string,args:string[])=>execFileSync(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,
    {env:{...env,PGPASSWORD:password},windowsHide:true,timeout:60000,stdio:name==='pg_ctl'?'ignore':'pipe'});
  const config={host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false as const,options:''};
  let started=false,pool:Pool|undefined,appPool:Pool|undefined;
  try {
    const pw=path.join(root,'password');writeFileSync(pw,password);
    pg('initdb',['-D',data,'-U','postgres','--auth=scram-sha-256','--pwfile='+pw,'--encoding=UTF8','--locale=C']);unlinkSync(pw);
    pg('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB`,'-w','start']);started=true;
    pool=new Pool(config);
    assert.equal(path.resolve((await pool.query('SHOW data_directory')).rows[0].data_directory).toLowerCase(),path.resolve(data).toLowerCase());
    const old=path.join(root,'migrations026');mkdirSync(old);
    for(const m of (await leerMigraciones()).filter(m=>m.version<='026'))copyFileSync(path.join(DIRECTORIO_MIGRACIONES,m.archivo),path.join(old,m.archivo));
    await ejecutarMigraciones(pool,{directorio:old,logger:()=>{}});
    await pool.query(`INSERT INTO usuario(id_usuario,nombre,email,password) VALUES(1,'Admin sintético','admin@example.test','no-login'),(2,'Propietario sintético','prop@example.test','no-login'),(3,'Perforador sintético','perf@example.test','no-login');
      INSERT INTO usuario_rol SELECT 1,id_rol FROM rol WHERE nombre='administracion';
      INSERT INTO usuario_rol SELECT 2,id_rol FROM rol WHERE nombre='propietario';
      INSERT INTO usuario_rol SELECT 3,id_rol FROM rol WHERE nombre='perforador';
      INSERT INTO pozo(origen,numero_perforacion,creado_por,profundidad_final_m,pre_filtro) VALUES('historico',NULL,1,30,'Grava histórica sin profundidad');
      INSERT INTO sello_sanitario_pozo VALUES(1,0,10);
      UPDATE numeracion_perforacion SET proximo=4000;`);
    const protegido=async()=> (await pool!.query(`SELECT (SELECT jsonb_agg(p ORDER BY id_pozo) FROM pozo p) pozos,
      (SELECT jsonb_agg(s) FROM sello_sanitario_pozo s) sellos,(SELECT jsonb_agg(n) FROM numeracion_perforacion n) contador,
      (SELECT jsonb_agg(p) FROM politica_numeracion p) politica,(SELECT jsonb_agg(u ORDER BY id_usuario) FROM usuario u) usuarios,
      (SELECT jsonb_agg(r) FROM numero_perforacion_reservado r) reservas`)).rows;
    await t.test('migración exclusivamente aditiva sobre 026, sin prefiltros inventados',async()=>{
      const before=await protegido();assert.deepEqual((await ejecutarMigraciones(pool!,{logger:()=>{}})).aplicadas,['027_prefiltro_constructivo.sql']);
      assert.deepEqual(await protegido(),before);assert.equal((await pool!.query('SELECT count(*) FROM prefiltro_pozo')).rows[0].count,'0');
      assert.deepEqual((await ejecutarMigraciones(pool!,{logger:()=>{}})).aplicadas,[]);
    });
    Object.assign(process.env,{NODE_ENV:'test',PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'postgres',PGPASSWORD:password,PGDATABASE:'postgres',FOTOS_DIR:path.join(root,'fotos'),FASTIFY_SECRET:randomBytes(32).toString('hex')});
    // El PDF HTTP tampoco consulta proveedores externos durante este ensayo.
    for(const key of Object.keys(process.env))if(/^(MAP_STATIC_|PDF_MAP_)/.test(key))delete process.env[key];
    appPool=(await import('../src/db/pool.ts')).myPool;
    const {crearPozoCompleto,actualizarPozoCompleto,huellaOffline}=await import('../src/services/pozo-completo-service.ts');
    const {crearHistorico,editarHistorico}=await import('../src/services/historicos-service.ts');
    const {getPozoById,updatePozo}=await import('../src/services/pozos-services.ts');
    const {getReportePozo}=await import('../src/services/generar-informe-consultas.ts');
    const {obtenerPrefiltro}=await import('../src/services/prefiltro-service.ts');
    const {crearPerfilLitologico}=await import('../src/pdf/perfil-litologico.ts');
    const {generarPDFBytes}=await import('../src/pdf/pdf-generate.ts');
    const epoca=(await pool.query('SELECT epoca FROM epoca_datos')).rows[0].epoca;
    const pf=[{desde_m:13.5,hasta_m:15.5},{desde_m:20,hasta_m:25}];
    const body=():PozoCompletoBody=>({pozo:{id_propietario:2,id_perforador:3,profundidad_final_m:30},sitio_nuevo:{departamento:'Salto',latitud:'-31',longitud:'-57'},
      intervalos_litologicos:[{desde_m:0,hasta_m:30,material:'Basalto marrón',id_litologia:1}],intervalos_diametro:[{desde_m:0,hasta_m:30,diametro_pulg:8,material_tuberia:'PVC'}],
      intervalos_filtro:[],niveles_aporte:[],prefiltro_constructivo:pf,sello_sanitario_constructivo:{desde_m:0,hasta_m:10}});
    let normal:Awaited<ReturnType<typeof crearPozoCompleto>>,historico:Awaited<ReturnType<typeof crearHistorico>>;
    const fotos=path.join(root,'fotos');mkdirSync(fotos);
    await t.test('creación normal e histórica y relectura de detalle/reporte',async()=>{
      normal=await crearPozoCompleto(3,body(),fotos,pool);
      historico=await crearHistorico(1,{numero_perforacion:null,profundidad_final_m:30,prefiltro_constructivo:pf},randomUUID(),epoca,pool);
      for(const id of [normal.pozo.id_pozo,historico.id_pozo]){
        assert.deepEqual(await obtenerPrefiltro(pool!,id),pf);
        assert.deepEqual((await getPozoById(id))!.prefiltro_constructivo,pf);
        assert.deepEqual((await getReportePozo(id,pool))!.prefiltro_constructivo,pf);
      }
    });
    const edit=():PozoCompletoUpdateBody=>({...body(),pozo:{...body().pozo,id_sitio:normal!.sitio.id_sitio},foto_accion:'conservar',prefiltro_constructivo:undefined});
    await t.test('edición normal/histórica: omitido conserva; array reemplaza; null y [] eliminan',async()=>{
      for(const valor of [undefined,[{desde_m:2,hasta_m:4}],null,pf,[],pf]){
        await actualizarPozoCompleto(normal!.pozo.id_pozo,{...edit(),prefiltro_constructivo:valor},fotos,pool);
        await editarHistorico(1,historico!.id_pozo,{empresa:'Ensayo',...(valor===undefined?{}:{prefiltro_constructivo:valor})},pool);
        for(const id of [normal!.pozo.id_pozo,historico!.id_pozo])assert.deepEqual(await obtenerPrefiltro(pool!,id),valor===undefined?pf:valor??[]);
      }
      await editarHistorico(1,1,{empresa:'No altera texto legado'},pool);
      assert.equal((await pool!.query('SELECT pre_filtro FROM pozo WHERE id_pozo=1')).rows[0].pre_filtro,'Grava histórica sin profundidad');
    });
    await t.test('errores de rango y reducción de profundidad no dejan escrituras parciales',async()=>{
      const before=await protegido(),pfs=(await pool!.query('SELECT * FROM prefiltro_pozo ORDER BY 1,2')).rows;
      await assert.rejects(actualizarPozoCompleto(normal!.pozo.id_pozo,{...edit(),prefiltro_constructivo:[{desde_m:3,hasta_m:40}]},fotos,pool));
      await assert.rejects(editarHistorico(1,historico!.id_pozo,{profundidad_final_m:5,empresa:'NO persistir'},pool));
      await assert.rejects(updatePozo(normal!.pozo.id_pozo,{id_propietario:2,profundidad_final_m:12}));
      // Falla después de guardar prefiltro: la transacción debe revertirlo.
      await assert.rejects(actualizarPozoCompleto(normal!.pozo.id_pozo,{...edit(),prefiltro_constructivo:[{desde_m:1,hasta_m:2}],intervalos_litologicos:[{desde_m:0,hasta_m:30,material:'Inexistente',id_litologia:999999}]},fotos,pool));
      assert.deepEqual(await protegido(),before);assert.deepEqual((await pool!.query('SELECT * FROM prefiltro_pozo ORDER BY 1,2')).rows,pfs);
    });
    await t.test('reintentos idempotentes nuevos y antiguos sin campo conservan identidad y resultado',async()=>{
      for(const nuevo of [false,true]){
        const b=body();b.pozo.id_propietario=null;b.pozo.propietario_provisional='Propietario sintético offline';
        if(!nuevo)delete b.prefiltro_constructivo;const hash=huellaOffline(b),clave=randomUUID();
        const a=await crearPozoCompleto(3,b,fotos,pool,clave,epoca),r=await crearPozoCompleto(3,b,fotos,pool,clave,epoca);
        assert.deepEqual(r,JSON.parse(JSON.stringify(a)));assert.equal(huellaOffline(b),hash);
        const h={numero_perforacion:null,profundidad_final_m:30,...(nuevo?{prefiltro_constructivo:pf}:{})},key=randomUUID();
        assert.deepEqual(await crearHistorico(1,h,key,epoca,pool),await crearHistorico(1,h,key,epoca,pool));
      }
      const antiguo={numero_perforacion:null},key=randomUUID(),resultado={id_pozo:1,numero_perforacion:null,origen:'historico'};
      await pool!.query('INSERT INTO creacion_historica(actor,clave,epoca,huella,resultado) VALUES(1,$1,$2,$3,$4)',[key,epoca,huellaOffline(antiguo),JSON.stringify(resultado)]);
      assert.deepEqual(await crearHistorico(1,antiguo,key,epoca,pool),resultado);
    });
    await t.test('restricciones SQL y ciclo de vida sin modificar campos legados',async()=>{
      for(const [d,h] of [[-1,2],[2,2],[3,2],[0,'NaN'],[0,'Infinity']])await assert.rejects(pool!.query('INSERT INTO prefiltro_pozo VALUES(1,$1,$2)',[d,h]));
      await pool!.query('INSERT INTO prefiltro_pozo VALUES(1,0,5)');
      await assert.rejects(pool!.query('INSERT INTO prefiltro_pozo VALUES(1,0,6)'));
      await pool!.query('BEGIN');await pool!.query('DELETE FROM pozo WHERE id_pozo=1');assert.equal((await pool!.query('SELECT * FROM prefiltro_pozo WHERE id_pozo=1')).rowCount,0);await pool!.query('ROLLBACK');
    });
    await t.test('casos visuales A–E persistidos: perfil y PDF desde PostgreSQL',async()=>{
      const casos=[{nombre:'A',sello:{desde_m:0,hasta_m:10},pf:[]},
        {nombre:'B',sello:null,pf:[pf[0]]},{nombre:'C',sello:{desde_m:0,hasta_m:10},pf},
        {nombre:'D',sello:null,pf:[]},{nombre:'E',sello:{desde_m:0,hasta_m:15},pf}];
      for(const caso of casos){
        const b=body();b.prefiltro_constructivo=caso.pf;b.sello_sanitario_constructivo=caso.sello;
        b.intervalos_filtro=[{desde_m:13.5,hasta_m:15.5,diametro_pulg:8,material_tuberia:'PVC',ranura_mm:0.5}];
        const creado=await crearPozoCompleto(3,b,fotos,pool),reporte=(await getReportePozo(creado.pozo.id_pozo,pool))!;
        const perfil=crearPerfilLitologico(reporte.litologia,reporte.profundidad_final_m,reporte.niveles_aporte,reporte.diametros,reporte.filtros,reporte.sello_sanitario_constructivo,reporte.prefiltro_constructivo);
        writeFileSync(path.join(root,caso.nombre+'.json'),JSON.stringify({body:b,detail:await getPozoById(creado.pozo.id_pozo),result:creado,perfil}));
        const pdf=await generarPDFBytes(reporte,creado.pozo.id_pozo,{directorioFotos:fotos,mapa:{}});assert.ok(pdf.length>1000);writeFileSync(path.join(root,caso.nombre+'.pdf'),pdf);
      }
    });
    await t.test('HTTP autenticado: preview y perfil persistido idénticos en A–E; PDF válido',async()=>{
      const Fastify=(await import('fastify')).default;
      const cookies=await import('../src/plugins/cookies.ts'),jwt=(await import('../src/plugins/jwt.ts')).default;
      const app=Fastify();await app.register(cookies.default);await app.register(jwt);app.decorate('rateLimitPdf',async()=>{});
      await app.register((await import('../src/routes/informes.ts')).default);
      try {
        const sesion={[cookies.SESSION_COOKIE]:app.jwt.sign({sub:1,version_sesion:1},{expiresIn:'1h'})};
        for(const caso of ['A','B','C','D','E']){
          const x=JSON.parse(readFileSync(path.join(root,caso+'.json'),'utf8')),url=`/usuarios/1/pozos/${x.detail.id_pozo}`;
          const saved=await app.inject({method:'GET',url:url+'/perfil-litologico',cookies:sesion});assert.equal(saved.statusCode,200,saved.body);
          const {pozo,sitio_nuevo,...tecnicos}=x.body;
          const preview=await app.inject({method:'POST',url:url+'/perfil-litologico/vista-previa',cookies:sesion,payload:{...tecnicos,profundidad_final_m:pozo.profundidad_final_m}});
          assert.equal(preview.statusCode,200,preview.body);
          // PostgreSQL devuelve false para tuberías antiguas; el borrador puede
          // omitirlo. Es el mismo estado, sin normalizar el payload real enviado.
          const comparable=(p:any)=>({...p,tuberias:p.tuberias.map((v:any)=>({...v,sin_tuberia:v.sin_tuberia??false}))});
          assert.deepEqual(comparable(preview.json()),comparable(saved.json()));
          const pdf=await app.inject({method:'GET',url:url+'/informe-pdf',cookies:sesion});assert.equal(pdf.statusCode,200,pdf.body.slice(0,100));assert.equal(pdf.rawPayload.subarray(0,5).toString(),'%PDF-');
        }
      } finally {await app.close();}
    });
    await t.test('dump/restore aislado conserva tabla, intervalos y texto legado',async()=>{
      const dump=path.join(root,'sintetico.dump'),args=['-h','127.0.0.1','-p',String(port),'-U','postgres'];
      pg('pg_dump',[...args,'-d','postgres','-Fc','-f',dump]);await pool!.query('CREATE DATABASE prefiltro_restore');
      pg('pg_restore',[...args,'-d','prefiltro_restore','--exit-on-error',dump]);
      const restored=new Pool({...config,database:'prefiltro_restore'});
      try{for(const table of ['prefiltro_pozo','pozo','sello_sanitario_pozo','politica_numeracion','numeracion_perforacion','schema_migrations'])
        assert.deepEqual((await restored.query(`SELECT row_to_json(t) j FROM ${table} t ORDER BY row_to_json(t)::text`)).rows,(await pool!.query(`SELECT row_to_json(t) j FROM ${table} t ORDER BY row_to_json(t)::text`)).rows);
      }finally{await restored.end();}
    });
    console.log('Evidencia sintética y PDF: '+root);
  } finally {
    await appPool?.end();await pool?.end();if(started)pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  }
});
