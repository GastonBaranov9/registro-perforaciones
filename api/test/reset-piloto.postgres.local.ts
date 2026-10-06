// Nunca carga .env. Sólo usuario y puerto explícitos del laboratorio desechable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { ejecutarMigraciones } from '../src/db/migrator.ts';

test('reset controlado en PostgreSQL aislada', async t=>{
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
  const {crearHistorico}=await import('../src/services/historicos-service.ts');
  const {resetPiloto,CLAVES_PILOTO}=await import('../src/services/reset-piloto-service.ts');
  try {
    const resetDb=db; const rp=pool;
    const body={pozo:{id_propietario:null,propietario_provisional:'Campo',id_perforador:3},sitio_nuevo:{departamento:'Salto',latitud:'-31',longitud:'-57'},intervalos_litologicos:[],intervalos_diametro:[],intervalos_filtro:[],niveles_aporte:[],foto:{mime_type:'image/png' as const,base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}};
    await ejecutarMigraciones(rp);
    await rp.query(`INSERT INTO usuario(id_usuario,nombre,email,password,activo,cuenta_acceso,version_sesion) VALUES
      (1,'Gaston Baranov','admin@test.local','test',true,true,4),(2,'Ramiro',NULL,NULL,true,false,1),
      (3,'Gaston Souza','perf@test.local','test',true,true,2),(6,'Luis Diaz','luis@test.local','test',true,true,1),(8,'Ricardo','ric@test.local','test',true,true,4);
      INSERT INTO usuario_rol VALUES(1,1),(2,3),(3,2),(6,2),(8,3);
      INSERT INTO sitio(id_sitio,departamento,localidad) VALUES(5,'Salto','Salto');
      INSERT INTO pozo(id_pozo,numero_perforacion,id_propietario,id_perforador,creado_por,id_sitio,foto_url) VALUES(5,2580,8,6,1,5,'/usuarios/8/pozos/5/foto');
      INSERT INTO numero_perforacion_reservado(numero_perforacion,id_pozo_original) VALUES(3001,4);
      UPDATE numeracion_perforacion SET mayor_asignado=3001;
      INSERT INTO intervalo_litologico(id_intervalo_litologico,id_pozo,desde_m,hasta_m,material) VALUES(44,5,0,10,'Basalto');
      INSERT INTO intervalo_diametro_perforacion(id_intervalo_diametro_perforacion,id_pozo,desde_m,hasta_m,diametro_pulg) VALUES(36,5,0,10,6);
      INSERT INTO intervalo_filtro(id_intervalo_filtro,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) VALUES(9,5,5,10,6,'PVC');
      INSERT INTO nivel_aporte(id_nivel_aporte,id_pozo,profundidad_m) VALUES(22,5,3),(23,5,8)`);
    const oldEpoch=(await rp.query('SELECT epoca FROM epoca_datos')).rows[0].epoca;
    for(const clave of CLAVES_PILOTO) await rp.query('INSERT INTO clave_offline_cerrada(actor,clave,epoca) VALUES(6,$1,$2)',[clave,oldEpoch]);
    // Sesiones/tickets sintéticos: también deben desaparecer sin resetear IDs.
    await rp.query(`INSERT INTO sesion_nativa(id_usuario,token_hash,installation_id,version_sesion_emitida,platform,app_build_at_login,expires_at)
      VALUES(6,decode(repeat('ab',32),'hex'),gen_random_uuid(),1,'android',1,now()+interval '1 day');
      INSERT INTO ticket_ws_nativo(id_sesion_nativa,ticket_hash,platform,app_build_emitido,expires_at)
      SELECT id_sesion_nativa,decode(repeat('cd',32),'hex'),'android',1,now()+interval '1 minute' FROM sesion_nativa`);
    const active=path.join(fotos,'pilot.jpg'),quarantine=path.join(fotos,'quarantine.jpg');await fs.writeFile(active,'photo-fixture');
    const options={database:resetDb,user:'rsp_reset_test',mantenimiento:true as const,verificarMigraciones:async()=>{},registrarPreparado:async()=>{},cuarentena:async()=>{await fs.rename(active,quarantine);},restaurarFoto:async()=>{await fs.rename(quarantine,active);}};
    await t.test('reset aborta por sitio inesperado y otro cliente, sin mover foto',async()=>{
      await rp.query("INSERT INTO sitio(id_sitio,departamento) VALUES(99,'Salto')");
      await assert.rejects(resetPiloto(rp,options),/Sitios distintos/);await fs.access(active);
      await rp.query('DELETE FROM sitio WHERE id_sitio=99');
      const other=new Pool({host:'127.0.0.1',port,user:'rsp_reset_test',database:resetDb});await other.query('SELECT 1');
      try{await assert.rejects(resetPiloto(rp,options),/otros clientes/);}finally{await other.end();}
    });
    await t.test('reset aborta ante usuario conservado ausente, admin adicional o reserva no inventariada',async()=>{
      await rp.query('DELETE FROM usuario_rol WHERE id_usuario=2; DELETE FROM usuario WHERE id_usuario=2');
      await assert.rejects(resetPiloto(rp,options),/Usuarios inesperados/); await fs.access(active);
      await rp.query("INSERT INTO usuario(id_usuario,nombre,email,password,activo,cuenta_acceso,version_sesion) VALUES(2,'Ramiro',NULL,NULL,true,false,1); INSERT INTO usuario_rol VALUES(2,3)");
      await rp.query('INSERT INTO usuario_rol VALUES(3,1)');
      await assert.rejects(resetPiloto(rp,options),/Administrador o relaciones/); await fs.access(active);
      await rp.query('DELETE FROM usuario_rol WHERE id_usuario=3 AND id_rol=1');
      await rp.query('INSERT INTO numero_perforacion_reservado(numero_perforacion,id_pozo_original) VALUES(2700,99)');
      await assert.rejects(resetPiloto(rp,options),/Reservas distintas/); await fs.access(active);
      await rp.query('DELETE FROM numero_perforacion_reservado WHERE numero_perforacion=2700');
    });
    await t.test('reset aborta por tablas, pozos, dependencias o claves inesperados',async()=>{
      for (const caso of [
        ['CREATE TABLE dato_no_inventariado(id integer)','DROP TABLE dato_no_inventariado',/Tablas inesperadas/],
        ["INSERT INTO pozo(id_pozo,numero_perforacion,id_propietario,id_perforador,id_sitio,creado_por) VALUES(99,2700,8,6,5,1)",'DELETE FROM pozo WHERE id_pozo=99; DELETE FROM numero_perforacion_reservado WHERE numero_perforacion=2700',/Pozo piloto distinto/],
        ['INSERT INTO nivel_aporte(id_nivel_aporte,id_pozo,profundidad_m) VALUES(99,5,9)','DELETE FROM nivel_aporte WHERE id_nivel_aporte=99',/Dependencias inesperadas/],
        ["INSERT INTO clave_offline_cerrada(actor,clave,epoca) SELECT 6,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',epoca FROM epoca_datos","DELETE FROM clave_offline_cerrada WHERE clave='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'",/Claves cerradas distintas/],
      ] as const) {
        await rp.query(caso[0]); await assert.rejects(resetPiloto(rp,options),caso[2]); await fs.access(active); await rp.query(caso[1]);
      }
    });
    await t.test('fallo antes de COMMIT restaura foto y datos',async()=>{
      await rp.query("CREATE FUNCTION fail_reset_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-failure'; END $$; CREATE TRIGGER fail_reset_test BEFORE DELETE ON pozo FOR EACH ROW EXECUTE FUNCTION fail_reset_test()");
      await assert.rejects(resetPiloto(rp,options));await fs.access(active);
      assert.equal((await rp.query('SELECT count(*) FROM pozo')).rows[0].count,'1');
      await rp.query('DROP TRIGGER fail_reset_test ON pozo; DROP FUNCTION fail_reset_test()');
    });
    await t.test('COMMIT incierto retiene cuarentena y exige diagnóstico antes de restaurar foto',async()=>{
      const uncertainPool={connect:async()=>{
        const client=await rp.connect();
        return new Proxy(client,{get(target,prop){
          if(prop==='query') return async(sql:string,params?:unknown[])=>{
            if(sql==='COMMIT') throw new Error('test: respuesta COMMIT incierta');
            return target.query(sql,params);
          };
          const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;
        }});
      }};
      await assert.rejects(resetPiloto(uncertainPool,options),/COMMIT incierta/);
      await fs.access(quarantine);await assert.rejects(fs.access(active));
      // Diagnóstico explícito del laboratorio: en este fallo inyectado se revirtió.
      assert.equal((await rp.query('SELECT epoca FROM epoca_datos')).rows[0].epoca,oldEpoch);
      assert.equal((await rp.query('SELECT count(*) FROM pozo')).rows[0].count,'1');
      await fs.rename(quarantine,active);
    });
    await t.test('corte conserva 1,2,3,6, cambia época, limpia piloto y deja 3282/0',async()=>{
      const result=await resetPiloto(rp,options);assert.notEqual(result.epoca,oldEpoch);
      assert.deepEqual((await rp.query('SELECT id_usuario,version_sesion FROM usuario ORDER BY id_usuario')).rows,[{id_usuario:'1',version_sesion:5},{id_usuario:'2',version_sesion:2},{id_usuario:'3',version_sesion:3},{id_usuario:'6',version_sesion:2}]);
      assert.equal((await rp.query('SELECT count(*) FROM clave_offline_cerrada')).rows[0].count,'0');await fs.access(quarantine);await assert.rejects(fs.access(active));
      await assert.rejects(crearPozoCompleto(6,{...body,pozo:{...body.pozo,id_perforador:6}},fotos,rp,randomUUID(),oldEpoch),{statusCode:410});
      await crearHistorico(1,{numero_perforacion:3281},randomUUID(),result.epoca,rp);
      await crearHistorico(1,{numero_perforacion:3280},randomUUID(),result.epoca,rp);
      await crearHistorico(1,{numero_perforacion:3279},randomUUID(),result.epoca,rp);
      assert.equal((await rp.query('SELECT proximo FROM numeracion_perforacion')).rows[0].proximo,'3282');
      assert.equal((await rp.query('SELECT mayor_asignado FROM numeracion_perforacion')).rows[0].mayor_asignado,3281);
      for (const clave of CLAVES_PILOTO) {
        const pilotBody={...body,pozo:{...body.pozo,id_perforador:6}};
        await assert.rejects(crearPozoCompleto(6,pilotBody,fotos,rp,clave,oldEpoch),{statusCode:410});
        await assert.rejects(crearPozoCompleto(6,pilotBody,fotos,rp,clave),{statusCode:410});
      }
      const fresh=await crearPozoCompleto(6,{...body,pozo:{...body.pozo,id_perforador:6}},fotos,rp,randomUUID(),result.epoca);
      assert.equal(fresh.pozo.numero_perforacion,3282);
      const next=await crearPozoCompleto(6,{...body,pozo:{...body.pozo,id_perforador:6}},fotos,rp,randomUUID(),result.epoca);
      assert.equal(next.pozo.numero_perforacion,3283);
      await assert.rejects(resetPiloto(rp,options));
    });
  } finally {
    await pool.end(); await control.query(`DROP DATABASE ${db} WITH (FORCE)`); await control.end();
    assert.ok(fotos.startsWith(path.join(os.tmpdir(),'rsp-epoch-'))); await fs.rm(fotos,{recursive:true,force:true});
  }
});
