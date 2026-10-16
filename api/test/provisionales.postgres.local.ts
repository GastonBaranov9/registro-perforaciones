// No lee .env. Requiere un clúster NUEVO desechable, usuario y puerto explícitos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { ejecutarMigraciones, DIRECTORIO_MIGRACIONES } from '../src/db/migrator.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('provisionales, permisos, migración y numeración en PostgreSQL desechable', async t => {
  const port=Number(process.env.RSP_RESET_TEST_PORT);
  assert.ok(port>1024&&port!==5432,'Puerto explícito de laboratorio requerido');
  const control=new Pool({host:'127.0.0.1',port,user:'rsp_reset_test',database:'postgres'});
  assert.equal((await control.query('SELECT current_user')).rows[0].current_user,'rsp_reset_test');
  const database=`rsp_reset_test_provisionales_${process.pid}_${Date.now()}`;
  await control.query(`CREATE DATABASE ${database}`);
  Object.assign(process.env,{PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'rsp_reset_test',PGDATABASE:database,
    NODE_ENV:'test',FASTIFY_SECRET:'provisionales-isolated-only-secret'});
  const {myPool:pool}=await import('../src/db/pool.ts');
  const {crearHistorico,editarHistorico}=await import('../src/services/historicos-service.ts');
  const {listarPendientes,vincularPendientes}=await import('../src/services/pendientes-service.ts');
  const {getReportePozo}=await import('../src/services/generar-informe-consultas.ts');
  const app=Fastify();
  const previas=await fs.mkdtemp(path.join(os.tmpdir(),'rsp-provisionales-migraciones-'));
  try {
    for(const f of (await fs.readdir(DIRECTORIO_MIGRACIONES)).filter(f=>/^\d{3}_.*\.sql$/.test(f)&&f<'019_'))
      await fs.copyFile(path.join(DIRECTORIO_MIGRACIONES,f),path.join(previas,f));
    await ejecutarMigraciones(pool,{directorio:previas});
    await pool.query(`INSERT INTO usuario(id_usuario,nombre,email,password) VALUES
      (1,'Admin','admin@test.local','test'),(2,'Alejandro Vanucci','owner@test.local','test'),
      (3,'Perforador','perf@test.local','test'),(4,'Operador','op@test.local','test');
      INSERT INTO usuario_rol VALUES(1,1),(2,3),(3,2);
      INSERT INTO usuario_rol SELECT 4,id_rol FROM rol WHERE nombre='operador_administrativo';
      UPDATE numeracion_perforacion SET proximo=3282`);
    await pool.query("INSERT INTO pozo(origen,numero_perforacion,creado_por,propietario_provisional) VALUES('historico',2099,1,'Propietario anterior a 019')");
    const migraciones=await ejecutarMigraciones(pool);
    assert.deepEqual(migraciones.aplicadas,['019_datos_provisionales.sql']);
    assert.deepEqual((await ejecutarMigraciones(pool)).aplicadas,[]);
    assert.ok((await listarPendientes(1,false,pool)).some(g=>g.texto==='Propietario anterior a 019'));
    const epoca=(await pool.query('SELECT epoca FROM epoca_datos')).rows[0].epoca;
    await app.register(cookie); await app.register((await import('../src/plugins/jwt.ts')).default);
    await app.register((await import('../src/plugins/error-handler.ts')).default);
    app.decorate('notifyClient',()=>{}); app.decorate('notifyAdmin',()=>{});
    app.decorate('rateLimitPdf',async()=>{});
    for(const route of ['usuarios','roles','numeracion-perforacion','litologias','pozos','historicos','pendientes','intervalos-litologicos','informes','sitios'])
      await app.register((await import(`../src/routes/${route}.ts`)).default);
    const {SESSION_COOKIE}=await import('../src/plugins/cookies.ts');
    const call=(actor:number,method:'GET'|'POST'|'PUT'|'PATCH',url:string,payload?:unknown,version=1)=>app.inject({method,url,
      ...(payload?{payload}:{}),cookies:{[SESSION_COOKIE]:app.jwt.sign({sub:actor,version_sesion:version},{expiresIn:'1h'})},
      headers:{'idempotency-key':randomUUID(),'x-epoca-datos':epoca}});
    const next=async()=>Number((await pool.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo);
    const catalogoAntes=(await pool.query('SELECT count(*) FROM catalogo_litologia')).rows[0].count;
    let h:number, normal:number, propio:number;
    await t.test('histórico 2100: provisional, desconocido, vinculado, trim, sin usuarios ni contador',async()=>{
      const r=await call(4,'POST','/pozos/historicos',{numero_perforacion:2100,propietario_provisional:'Alejandro Vanucci',perforador_provisional:' Alejandro Vanucci ',
        intervalos_litologicos:[{desde_m:0,hasta_m:5,material:'Arena arcillosa roja',litologia_provisional:' Arena arcillosa roja '}]});
      assert.equal(r.statusCode,201,r.body);h=r.json().id_pozo;
      assert.equal(await next(),3282);
      const p=(await pool.query('SELECT * FROM pozo WHERE id_pozo=$1',[h])).rows[0];
      assert.equal(p.id_perforador,null);assert.equal(p.perforador_provisional,'Alejandro Vanucci');assert.equal(p.creado_por,'4');
      await crearHistorico(4,{numero_perforacion:2101},randomUUID(),epoca,pool);
      await crearHistorico(1,{numero_perforacion:2102,id_perforador:3},randomUUID(),epoca,pool);
      await assert.rejects(crearHistorico(4,{numero_perforacion:2103,id_perforador:3,perforador_provisional:'Contradicción'},randomUUID(),epoca,pool),{statusCode:400});
      assert.equal((await pool.query('SELECT count(*) FROM usuario')).rows[0].count,'4');
      const edit=await call(4,'PATCH',`/pozos/historicos/${h}`,{empresa:'Archivo'});assert.equal(edit.statusCode,200,edit.body);
      assert.equal((await pool.query('SELECT perforador_provisional FROM pozo WHERE id_pozo=$1',[h])).rows[0].perforador_provisional,'Alejandro Vanucci');
    });
    await t.test('operador normal: alcance del perforador, ventana 24h, propietario sólo propio y contador automático',async()=>{
      const candidatos=await call(4,'GET','/pozos/candidatos-personas');
      assert.equal(candidatos.statusCode,200,candidatos.body);
      assert.deepEqual(candidatos.json().perforadores.map((x:any)=>x.id_usuario),[4]);
      assert.equal((await call(4,'GET','/pozos/candidatos-personas?propietario=Alejandro')).statusCode,403);
      const historicos=await call(4,'GET','/pozos/candidatos-personas?historico=true&propietario=Alejandro');
      assert.equal(historicos.statusCode,200,historicos.body);assert.equal(historicos.json().propietarios.length,1);
      const body=(id:number)=>({pozo:{id_perforador:id,id_propietario:null,propietario_provisional:'Propietario preexistente'},sitio_nuevo:{departamento:'Salto',latitud:'-31',longitud:'-57'},intervalos_litologicos:[],intervalos_diametro:[],intervalos_filtro:[],niveles_aporte:[]});
      const perf=await call(3,'POST','/usuarios/3/pozos/completo',body(3));assert.equal(perf.statusCode,201,perf.body);normal=perf.json().pozo.id_pozo;
      assert.equal(perf.json().pozo.numero_perforacion,3282);
      const op=await call(4,'POST','/usuarios/999/pozos/completo',body(4));assert.equal(op.statusCode,201,op.body);propio=op.json().pozo.id_pozo;
      assert.equal(op.json().pozo.numero_perforacion,3283);
      assert.equal((await call(4,'POST','/usuarios/4/pozos/completo',body(3))).statusCode,403);
      assert.equal((await call(2,'POST','/usuarios/2/pozos/completo',body(2))).statusCode,403);
      assert.equal((await call(4,'GET',`/usuarios/4/pozos/${normal}`)).statusCode,404);
      const lit={desde_m:0,hasta_m:3,material:'Tosca gris compacta',litologia_provisional:'Tosca gris compacta'};
      assert.equal((await call(4,'POST',`/usuarios/4/pozos/${normal}/intervalo_litologico`,lit)).statusCode,403);
      const creado=await call(4,'POST',`/usuarios/4/pozos/${propio}/intervalo_litologico`,lit);assert.equal(creado.statusCode,201,creado.body);
      await pool.query("UPDATE pozo SET fecha_creado=now()-interval '25 hours' WHERE id_pozo=$1",[propio]);
      assert.equal((await call(4,'POST',`/usuarios/4/pozos/${propio}/intervalo_litologico`,{...lit,desde_m:3,hasta_m:4})).statusCode,403);
      const lista=await call(4,'GET','/usuarios/999/pozos');assert.equal(lista.statusCode,200,lista.body);
      assert.ok(lista.json().some((p:any)=>p.id_pozo===h));assert.ok(!lista.json().some((p:any)=>p.id_pozo===normal));
      assert.equal((await call(4,'GET','/pozos/exportar/kml')).statusCode,403);
    });
    await t.test('detalle y PDF usan provisionales; catálogo no cambia ni vincula por nombre',async()=>{
      const r=await call(4,'GET',`/usuarios/4/pozos/${h}`);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().perforador_nombre,'Alejandro Vanucci');
      const reporte=await getReportePozo(h,pool);assert.equal(reporte?.perforador,'Alejandro Vanucci');assert.equal(reporte?.litologia[0].material,'Arena arcillosa roja');
      const pdf=await call(4,'GET',`/usuarios/4/pozos/${h}/informe-pdf`);assert.equal(pdf.statusCode,200,pdf.body);assert.equal(pdf.rawPayload.subarray(0,5).toString(),'%PDF-');
      assert.equal((await pool.query('SELECT count(*) FROM catalogo_litologia')).rows[0].count,catalogoAntes);
      const nombre=(await pool.query('SELECT nombre FROM catalogo_litologia WHERE id_litologia=1')).rows[0].nombre;
      await editarHistorico(4,h,{intervalos_litologicos:[{desde_m:0,hasta_m:5,material:nombre,litologia_provisional:nombre}]},pool);
      const i=(await pool.query('SELECT * FROM intervalo_litologico WHERE id_pozo=$1',[h])).rows[0];assert.equal(i.id_litologia,null);assert.equal(i.litologia_provisional,nombre);
      const vacio=await call(4,'PATCH',`/pozos/historicos/${h}`,{intervalos_litologicos:[{desde_m:0,hasta_m:5,material:' ',litologia_provisional:' '}]});assert.equal(vacio.statusCode,400,vacio.body);
      const guardado=await call(4,'PUT',`/usuarios/4/pozos/${h}/intervalo_litologico/${i.id_intervalo_litologico}`,{desde_m:0,hasta_m:5,material:nombre,id_litologia:null,litologia_provisional:nombre});
      assert.equal(guardado.statusCode,200,guardado.body);assert.equal(guardado.json().litologia_provisional,nombre);
      const catalogado=await call(4,'PUT',`/usuarios/4/pozos/${h}/intervalo_litologico/${i.id_intervalo_litologico}`,{desde_m:0,hasta_m:5,material:nombre,id_litologia:1});
      assert.equal(catalogado.statusCode,403,catalogado.body);
      assert.equal((await pool.query('SELECT litologia_provisional FROM intervalo_litologico WHERE id_intervalo_litologico=$1',[i.id_intervalo_litologico])).rows[0].litologia_provisional,nombre);
      const antes=(await pool.query('SELECT * FROM pozo WHERE id_pozo=$1',[h])).rows;
      const reemplazo=await call(4,'PATCH',`/pozos/historicos/${h}`,{empresa:'No guardar',intervalos_litologicos:[{id_intervalo_litologico:Number(i.id_intervalo_litologico),desde_m:0,hasta_m:5,material:nombre,id_litologia:1}]});
      assert.equal(reemplazo.statusCode,403,reemplazo.body);
      assert.deepEqual((await pool.query('SELECT * FROM pozo WHERE id_pozo=$1',[h])).rows,antes);
      assert.equal((await pool.query('SELECT litologia_provisional FROM intervalo_litologico WHERE id_intervalo_litologico=$1',[i.id_intervalo_litologico])).rows[0].litologia_provisional,nombre);
      const provisional=await call(4,'PUT',`/usuarios/4/pozos/${h}/intervalo_litologico/${i.id_intervalo_litologico}`,{desde_m:0,hasta_m:5,material:nombre,litologia_provisional:nombre});
      assert.equal(provisional.statusCode,200,provisional.body);assert.equal(provisional.json().id_litologia,null);
    });
    await t.test('sólo admin lista/vincula pendientes y administra usuarios, roles, catálogo y numeración',async()=>{
      for(const actor of [2,3,4]) {
        for(const url of ['/administracion/personas-pendientes','/administracion/litologias-pendientes','/pozos/numeracion','/usuarios','/roles'])
          assert.equal((await call(actor,'GET',url)).statusCode,403,`${actor} ${url}`);
        assert.equal((await call(actor,'POST','/usuarios',{nombre:'Prohibido',email:'no@test.local',password:'ClaveDePrueba123!',activo:true,roles:[{id_rol:3,nombre:'propietario',descr:'Propietario'}]})).statusCode,403);
        assert.equal((await call(actor,'POST','/administracion/pendientes/vincular',{tipo:'propietario',destino:2,ocurrencias:[{id:h,id_pozo:h,texto:'Alejandro Vanucci',version:'1',version_pozo:'1'}]})).statusCode,403);
        assert.equal((await call(actor,'POST','/litologias',{codigo:'prohibida',nombre:'No',familia:'otro',color:'#123456',patron:'clay',orden:1})).statusCode,403);
      }
      const {exigirAdministracionNumeracion}=await import('../src/services/numeracion-perforacion-service.ts');
      await assert.rejects(exigirAdministracionNumeracion(4,pool),{statusCode:403});
    });
    await t.test('pendientes existentes, selección explícita, lote atómico, conflicto concurrente y limpieza',async()=>{
      const grupos=await listarPendientes(1,false,pool);
      assert.ok(grupos.some(g=>g.tipo==='propietario'&&g.texto==='Propietario preexistente'&&g.ocurrencias.length===2));
      const nombre=grupos.find(g=>g.tipo==='propietario'&&g.texto==='Alejandro Vanucci')!;
      assert.equal(nombre.ocurrencias.length,1); // Identidad del mismo nombre ya existía y no se vinculó.
      const grupo=grupos.find(g=>g.texto==='Propietario preexistente')!;
      await pool.query("UPDATE pozo SET empresa='Cambio concurrente' WHERE id_pozo=$1",[propio]);
      await assert.rejects(vincularPendientes(1,{tipo:'propietario',destino:2,ocurrencias:grupo.ocurrencias},pool),{statusCode:409});
      assert.equal((await pool.query('SELECT count(*) FROM pozo WHERE id_pozo=ANY($1::bigint[]) AND id_propietario IS NOT NULL',[[normal,propio]])).rows[0].count,'0');
      const fresco=(await listarPendientes(1,false,pool)).find(g=>g.texto==='Propietario preexistente')!;
      await vincularPendientes(1,{tipo:'propietario',destino:2,ocurrencias:[fresco.ocurrencias[0]]},pool);
      assert.equal((await listarPendientes(1,false,pool)).find(g=>g.texto==='Propietario preexistente')?.ocurrencias.length,1);
      const perf=(await listarPendientes(1,false,pool)).find(g=>g.tipo==='perforador')!;
      await vincularPendientes(1,{tipo:'perforador',destino:3,ocurrencias:perf.ocurrencias},pool);
      const p=(await pool.query('SELECT * FROM pozo WHERE id_pozo=$1',[h])).rows[0];assert.equal(p.perforador_provisional,null);assert.equal(p.id_perforador,'3');assert.equal(p.creado_por,'4');
      assert.equal((await getReportePozo(h,pool))?.perforador,'Perforador');
    });
    await t.test('litologías pendientes: stale, rollback, catálogo explícito y limpieza',async()=>{
      const grupos=await listarPendientes(1,true,pool);assert.equal(grupos.length,2);
      const seleccion=grupos.flatMap(g=>g.ocurrencias);
      await pool.query("UPDATE intervalo_litologico SET material='Cambio' WHERE id_intervalo_litologico=$1",[seleccion[1].id]);
      await assert.rejects(vincularPendientes(1,{tipo:'litologia',destino:1,ocurrencias:seleccion},pool),{statusCode:409});
      assert.equal((await pool.query('SELECT count(*) FROM intervalo_litologico WHERE litologia_provisional IS NOT NULL')).rows[0].count,'2');
      const fresco=(await listarPendientes(1,true,pool)).flatMap(g=>g.ocurrencias);
      const catalogo=await call(1,'POST','/litologias',{codigo:'observacion_validada',nombre:'Material validado',familia:'otro',color:'#123456',patron:'clay',orden:40});
      assert.equal(catalogo.statusCode,201,catalogo.body);const destino=catalogo.json().id_litologia;
      await vincularPendientes(1,{tipo:'litologia',destino,ocurrencias:fresco},pool);
      assert.deepEqual(await listarPendientes(1,true,pool),[]);
      assert.equal((await pool.query('SELECT count(*) FROM intervalo_litologico WHERE id_litologia=$1',[destino])).rows[0].count,'2');
      assert.equal(await next(),3284);
    });
    await t.test('HTTP admin vincula múltiples ocurrencias, con snapshot y confirmación explícita',async()=>{
      const listado=await call(1,'GET','/administracion/personas-pendientes');assert.equal(listado.statusCode,200,listado.body);
      const ocurrencias=listado.json().filter((g:any)=>g.tipo==='propietario').flatMap((g:any)=>g.ocurrencias)
        .map(({id,id_pozo,texto,version,version_pozo}:any)=>({id,id_pozo,texto,version,version_pozo}));
      const r=await call(1,'POST','/administracion/pendientes/vincular',{tipo:'propietario',destino:2,ocurrencias});
      assert.equal(r.statusCode,200,r.body);assert.equal(r.json().vinculadas,ocurrencias.length);
      assert.equal((await call(1,'POST','/administracion/pendientes/vincular',{tipo:'propietario',destino:2,ocurrencias})).statusCode,409);
      assert.deepEqual(await listarPendientes(1,false,pool),[]);
      assert.equal((await call(2,'GET',`/usuarios/2/pozos/${h}`)).statusCode,200);
      assert.equal((await call(2,'POST',`/usuarios/2/pozos/${h}/intervalo_litologico`,{desde_m:5,hasta_m:6,material:'Observado',litologia_provisional:'Observado'})).statusCode,403);
    });
    await t.test('dos conexiones: edición mientras espera el lote produce 409 y rollback completo',async()=>{
      const a=await crearHistorico(4,{numero_perforacion:2110,perforador_provisional:'Perforador concurrente'},randomUUID(),epoca,pool);
      const b=await crearHistorico(4,{numero_perforacion:2111,perforador_provisional:'Perforador concurrente'},randomUUID(),epoca,pool);
      const ocurrencias=(await listarPendientes(1,false,pool)).find(g=>g.texto==='Perforador concurrente')!.ocurrencias;
      const bloqueo=await pool.connect();let resultado:Promise<void>|undefined;
      try {
        await bloqueo.query('BEGIN');await bloqueo.query('SELECT pg_advisory_xact_lock($1::int,606)',[b.id_pozo]);
        await bloqueo.query("UPDATE pozo SET perforador_provisional='Otro perforador' WHERE id_pozo=$1",[b.id_pozo]);
        resultado=assert.rejects(vincularPendientes(1,{tipo:'perforador',destino:3,ocurrencias},pool),{statusCode:409});
        let esperando=false;
        for(let n=0;n<200&&!esperando;n++) {
          esperando=(await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'SELECT pg_advisory_xact_lock(id,606)%' AND cardinality(pg_blocking_pids(pid))>0")).rows.length>0;
          if(!esperando)await delay(10);
        }
        assert.ok(esperando,'el lote espera el bloqueo de la segunda conexión');
        await bloqueo.query('COMMIT');await resultado;
        const primero=(await pool.query('SELECT id_perforador,perforador_provisional FROM pozo WHERE id_pozo=$1',[a.id_pozo])).rows[0];
        assert.equal(primero.id_perforador,null);assert.equal(primero.perforador_provisional,'Perforador concurrente');
      } finally { await bloqueo.query('ROLLBACK');bloqueo.release();await resultado; }
    });
    await t.test('regresión: PATCH histórico no vincula personas y conserva atomicidad',async()=>{
      const nuevo=await crearHistorico(4,{numero_perforacion:2113,perforador_provisional:'Perforador pendiente',propietario_provisional:'Propietario pendiente'},randomUUID(),epoca,pool);
      const snapshot=async()=>(await pool.query('SELECT * FROM pozo WHERE id_pozo=$1',[nuevo.id_pozo])).rows;
      const antes=await snapshot();
      for(const payload of [{id_perforador:3,perforador_provisional:null},{id_propietario:2,propietario_provisional:null}]) {
        const r=await call(4,'PATCH',`/pozos/historicos/${nuevo.id_pozo}`,{...payload,empresa:'No guardar'});
        assert.equal(r.statusCode,403,r.body);assert.deepEqual(await snapshot(),antes);
      }
      assert.equal((await call(4,'PATCH',`/pozos/historicos/${nuevo.id_pozo}`,{perforador_provisional:'Texto corregido'})).statusCode,200);
      assert.equal((await call(4,'PATCH',`/pozos/historicos/${nuevo.id_pozo}`,{perforador_provisional:null})).statusCode,200);
      assert.equal((await call(4,'PATCH',`/pozos/historicos/${nuevo.id_pozo}`,{perforador_provisional:'Perforador pendiente'})).statusCode,200);
      for(const tipo of ['perforador','propietario'] as const) {
        const grupo=(await listarPendientes(1,false,pool)).find(g=>g.tipo===tipo&&g.ocurrencias.some(o=>o.id_pozo===nuevo.id_pozo))!;
        const ocurrencias=grupo.ocurrencias.filter(o=>o.id_pozo===nuevo.id_pozo).map(({id,id_pozo,texto,version,version_pozo})=>({id,id_pozo,texto,version,version_pozo}));
        const r=await call(1,'POST','/administracion/pendientes/vincular',{tipo,destino:tipo==='perforador'?3:2,ocurrencias});
        assert.equal(r.statusCode,200,r.body);
        assert.equal((await call(1,'POST','/administracion/pendientes/vincular',{tipo,destino:tipo==='perforador'?3:2,ocurrencias})).statusCode,409);
      }
    });
    await t.test('regresión: nuevos intervalos, editor completo, legados y normalización administrativa',async()=>{
      for(const actor of [3,4]) {
        const payload={pozo:{id_perforador:actor,id_propietario:null,propietario_provisional:'Cliente regresión'},sitio_nuevo:{departamento:'Salto',latitud:'-31',longitud:'-57'},
          intervalos_litologicos:[{desde_m:0,hasta_m:1,material:'Catálogo',id_litologia:1},{desde_m:1,hasta_m:2,material:'Observado',litologia_provisional:'Observado'},{desde_m:2,hasta_m:3,material:' Texto antiguo '}],intervalos_diametro:[],intervalos_filtro:[],niveles_aporte:[]};
        const creado=await call(actor,'POST',`/usuarios/${actor}/pozos/completo`,payload);assert.equal(creado.statusCode,201,creado.body);
        const id=creado.json().pozo.id_pozo;
        const filas=async()=>(await pool.query('SELECT * FROM intervalo_litologico WHERE id_pozo=$1 ORDER BY desde_m',[id])).rows;
        const originales=await filas();assert.equal(originales[0].id_litologia,'1');assert.equal(originales[1].litologia_provisional,'Observado');assert.equal(originales[2].litologia_provisional,'Texto antiguo');
        const individual=await call(actor,'POST',`/usuarios/${actor}/pozos/${id}/intervalo_litologico`,{desde_m:3,hasta_m:4,material:'Texto individual'});
        assert.equal(individual.statusCode,201,individual.body);assert.equal(individual.json().litologia_provisional,'Texto individual');
        const antes=await filas();
        const r=await call(actor,'PUT',`/usuarios/${actor}/pozos/${id}/intervalo_litologico/${originales[1].id_intervalo_litologico}`,{desde_m:1,hasta_m:2,material:'Catálogo',id_litologia:1});
        assert.equal(r.statusCode,403,r.body);assert.deepEqual(await filas(),antes);
        const completo={pozo:{...payload.pozo,id_sitio:creado.json().pozo.id_sitio},intervalos_litologicos:[{id_intervalo_litologico:Number(originales[1].id_intervalo_litologico),desde_m:1,hasta_m:2,material:'Catálogo',id_litologia:1}],intervalos_diametro:[],intervalos_filtro:[],niveles_aporte:[],foto_accion:'conservar'};
        for(const conId of [true,false]) {
          const intento=structuredClone(completo);if(!conId)delete (intento.intervalos_litologicos[0] as any).id_intervalo_litologico;
          const edit=await call(actor,'PUT',`/usuarios/${actor}/pozos/${id}/completo`,intento);assert.equal(edit.statusCode,403,edit.body);assert.deepEqual(await filas(),antes);
        }
        const propietario=await call(actor,'PUT',`/usuarios/${actor}/pozos/${id}/completo`,{...completo,pozo:{...completo.pozo,id_propietario:2,propietario_provisional:null}});
        assert.ok([400,403].includes(propietario.statusCode),propietario.body);assert.deepEqual(await filas(),antes);
        const ocurrencias=(await listarPendientes(1,true,pool)).flatMap(g=>g.ocurrencias).filter(o=>o.id_pozo===id).map(({id,id_pozo,texto,version,version_pozo})=>({id,id_pozo,texto,version,version_pozo}));
        assert.equal((await call(1,'POST','/administracion/pendientes/vincular',{tipo:'litologia',destino:1,ocurrencias})).statusCode,200);
        assert.ok((await filas()).every(i=>i.id_litologia==='1'&&i.litologia_provisional===null));
      }
      const contador=await next();
      const legado=await crearHistorico(4,{numero_perforacion:2114,id_perforador:3,id_propietario:2},randomUUID(),epoca,pool);
      const viejo=(await pool.query("INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material) VALUES($1,0,1,'Legado sin clasificación') RETURNING id_intervalo_litologico",[legado.id_pozo])).rows[0];
      const edit=await call(4,'PATCH',`/pozos/historicos/${legado.id_pozo}`,{intervalos_litologicos:[{id_intervalo_litologico:Number(viejo.id_intervalo_litologico),desde_m:0,hasta_m:2,material:'Legado corregido'},{desde_m:2,hasta_m:3,material:'Nueva observación'}]});
      assert.equal(edit.statusCode,200,edit.body);
      const filas=(await pool.query('SELECT * FROM intervalo_litologico WHERE id_pozo=$1 ORDER BY desde_m',[legado.id_pozo])).rows;
      assert.equal(filas[0].id_litologia,null);assert.equal(filas[0].litologia_provisional,null);assert.equal(filas[1].litologia_provisional,'Nueva observación');
      assert.equal(await next(),contador);
    });
    await t.test('regresión: operador multirrol lista históricos y sólo normales de su alcance',async()=>{
      const ajeno=(await pool.query("INSERT INTO pozo(origen,numero_perforacion,creado_por,id_propietario,id_perforador,id_sitio) SELECT 'normal',NULL,3,2,3,id_sitio FROM pozo WHERE id_pozo=$1 RETURNING id_pozo",[normal])).rows[0].id_pozo;
      const comoPropietario=(await pool.query("INSERT INTO pozo(origen,numero_perforacion,creado_por,id_propietario,id_perforador,id_sitio) SELECT 'normal',NULL,3,4,3,id_sitio FROM pozo WHERE id_pozo=$1 RETURNING id_pozo",[normal])).rows[0].id_pozo;
      try {
        for(const extras of [[],[3],[2],[2,3]]) {
          await pool.query('DELETE FROM usuario_rol WHERE id_usuario=4 AND id_rol IN (2,3)');
          for(const rol of extras)await pool.query('INSERT INTO usuario_rol VALUES(4,$1)',[rol]);
          const lista=await call(4,'GET','/usuarios/999/pozos');assert.equal(lista.statusCode,200,lista.body);
          const ids=lista.json().map((p:any)=>p.id_pozo);
          assert.ok(ids.includes(h));assert.ok(ids.includes(propio));assert.ok(!ids.includes(Number(ajeno)));
          assert.equal(ids.includes(Number(comoPropietario)),extras.includes(3));
          for(const [id,esperado] of [[h,200],[propio,200],[ajeno,404],[comoPropietario,extras.includes(3)?200:404]])
            assert.equal((await call(4,'GET',`/usuarios/4/pozos/${id}`)).statusCode,esperado);
        }
      } finally {await pool.query('DELETE FROM usuario_rol WHERE id_usuario=4 AND id_rol IN (2,3)');}
    });
    await t.test('sesión revocada: 401 y sin escrituras administrativas',async()=>{
      const ocurrencias=(await listarPendientes(1,false,pool)).find(g=>g.tipo==='perforador')!.ocurrencias;
      await pool.query('UPDATE usuario SET version_sesion=2 WHERE id_usuario=1');
      assert.equal((await call(1,'GET','/administracion/personas-pendientes')).statusCode,401);
      const {contextoEscritura}=await import('../src/services/escritura-sesion.ts');
      await assert.rejects(contextoEscritura.run({idUsuario:1,versionSesion:1,capacidad:'administrarUsuarios'},()=>vincularPendientes(1,{tipo:'perforador',destino:3,ocurrencias},pool)),{statusCode:401});
    });
    await t.test('perforador provisional no se presenta como propietario ausente',async()=>{
      const p=await crearHistorico(4,{numero_perforacion:2112,perforador_provisional:'Solo perforador'},randomUUID(),epoca,pool);
      const lista=await call(4,'GET','/usuarios/4/pozos');
      assert.equal(lista.statusCode,200,lista.body);
      assert.equal(lista.json().find((x:any)=>x.id_pozo===p.id_pozo).propietario_nombre,'');
      const detalle=await call(4,'GET',`/usuarios/4/pozos/${p.id_pozo}`);
      assert.equal(detalle.statusCode,200,detalle.body);
      assert.equal(detalle.json().propietario_nombre,null);
      assert.equal(detalle.json().perforador_nombre,'Solo perforador');
    });
  } finally {
    await app.close();await pool.end();
    await control.query(`DROP DATABASE ${database} WITH (FORCE)`);await control.end();
    assert.ok(path.resolve(previas).startsWith(path.resolve(os.tmpdir())+path.sep+'rsp-provisionales-migraciones-'));
    await fs.rm(previas,{recursive:true,force:true});
  }
});
