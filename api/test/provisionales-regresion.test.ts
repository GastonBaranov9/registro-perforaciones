import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '../src/plugins/jwt.ts';
import historicos from '../src/routes/historicos.ts';
import intervalos from '../src/routes/intervalos-litologicos.ts';
import { SESSION_COOKIE } from '../src/plugins/cookies.ts';
import { myPool } from '../src/db/pool.ts';
import { provisionalParaIntervaloNuevo } from '../src/services/litologia-provisional.ts';
import { reemplazarHijosPozo, insertarHijos } from '../src/services/pozo-completo-service.ts';

test('HTTP: editores rechazan resolver provisionales persistidos y revierten la transacción', async t => {
  process.env.FASTIFY_SECRET = 'provisionales-regresion-mock-only';
  let rol = 'operador_administrativo';
  const consultas: string[] = [];
  const original = {id_pozo:22,origen:'historico',numero_perforacion:2100,creado_por:7,
    id_perforador:null,perforador_provisional:'Perforador observado',id_propietario:null,propietario_provisional:'Propietario observado'};
  const query = async (sql: string) => {
    consultas.push(sql);
    if (sql.includes('SELECT activo, version_sesion')) return {rows:[{activo:true,version_sesion:1}]};
    if (sql.includes('session-write-user-lock')) return {rows:[{activo:true,cuenta_acceso:true,version_sesion:1}]};
    if (sql.includes('SELECT r.nombre FROM rol r')) return {rows:[{nombre:rol}]};
    if (sql.includes('SELECT creado_por')) return {rows:[{...original,origen:rol==='perforador'?'normal':'historico',fecha_creado:new Date(Date.now()-1000)}]};
    if (sql.includes('SELECT * FROM pozo') || sql.includes('SELECT origen FROM pozo')) return {rows:[original]};
    if (sql.includes('SELECT litologia_provisional')) return {rows:[{litologia_provisional:'Tosca'}]};
    if (sql.includes('SELECT profundidad_final_m')) return {rows:[{profundidad_final_m:null}]};
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.includes('pg_advisory_xact_lock')) return {rows:[]};
    throw Error('SQL no esperado: '+sql);
  };
  t.mock.method(myPool,'query',query);
  t.mock.method(myPool,'connect',async()=>({query,release(){}}));
  const app=Fastify();
  await app.register(cookie);await app.register(jwt);await app.register(historicos);await app.register(intervalos);
  const credentials={[SESSION_COOKIE]:app.jwt.sign({sub:7,version_sesion:1},{expiresIn:'1h'})};
  try {
    for (const payload of [
      {id_perforador:3,perforador_provisional:null,empresa:'No guardar'},
      {id_propietario:2,propietario_provisional:null,empresa:'No guardar'},
    ]) {
      consultas.length=0;
      const r=await app.inject({method:'PATCH',url:'/pozos/historicos/22',cookies:credentials,payload});
      assert.equal(r.statusCode,403,r.body);
      assert.ok(consultas.includes('ROLLBACK'));assert.ok(!consultas.some(q=>/^(UPDATE|INSERT|DELETE)/.test(q)));
    }
    for (rol of ['operador_administrativo','perforador','administracion']) {
      consultas.length=0;
      const r=await app.inject({method:'PUT',url:'/usuarios/7/pozos/22/intervalo_litologico/9',cookies:credentials,
        payload:{desde_m:0,hasta_m:2,material:'Basalto',id_litologia:1}});
      assert.equal(r.statusCode,403,r.body);
      assert.ok(consultas.includes('ROLLBACK'));assert.ok(!consultas.some(q=>q.includes('UPDATE intervalo_litologico')));
    }
  } finally {await app.close();}
});

test('reemplazo completo no resuelve provisional omitiendo el ID de la ocurrencia', async()=>{
  for (const id_intervalo_litologico of [9,undefined]) {
    const consultas:string[]=[];
    const db={query:async(sql:string)=>{consultas.push(sql);return {rows:[{id_intervalo_litologico:9,desde_m:0,hasta_m:2,material:'Tosca',id_litologia:null,litologia_provisional:'Tosca'}]};}};
    await assert.rejects(reemplazarHijosPozo(db as never,22,{intervalos_litologicos:[{id_intervalo_litologico,desde_m:0,hasta_m:2,material:'Basalto',id_litologia:1}],intervalos_diametro:[],intervalos_filtro:[],niveles_aporte:[]}),{statusCode:403});
    assert.ok(!consultas.some(q=>q.startsWith('DELETE')));
  }
});

test('alta nueva convierte texto antiguo a provisional, nunca infiere identidad por nombre',()=>{
  assert.equal(provisionalParaIntervaloNuevo({material:'  Basalto  '}),'Basalto');
  assert.equal(provisionalParaIntervaloNuevo({material:'Basalto',id_litologia:1}),null);
  assert.equal(provisionalParaIntervaloNuevo({material:'Otro',litologia_provisional:' Tosca '}),'Tosca');
  for(const material of ['', ' ', 'x'.repeat(161)]) assert.throws(()=>provisionalParaIntervaloNuevo({material}),{statusCode:400});
});

test('inserción completa distingue nuevo de legado existente con ambos campos NULL',async()=>{
  const data={intervalos_litologicos:[{id_intervalo_litologico:9,desde_m:0,hasta_m:2,material:'Legado'}],intervalos_diametro:[],intervalos_filtro:[],niveles_aporte:[]};
  const parametros:unknown[][]=[];
  const db={query:async(_sql:string,p:unknown[])=>{parametros.push(p);return {rows:[{id_intervalo_litologico:10,id_pozo:22,desde_m:0,hasta_m:2,material:p[7]??p[3],id_litologia:p[4],litologia_provisional:p[7]}]};}};
  await insertarHijos(db as never,22,data);
  assert.equal(parametros[0][7],'Legado');
  await insertarHijos(db as never,22,data,[{...data.intervalos_litologicos[0],id_litologia:null}],new Map([[0,null]]));
  assert.equal(parametros[1][4],null);assert.equal(parametros[1][7],null);
});
