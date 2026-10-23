import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarPropiedad, vincularPropietarioPozo } from '../src/services/propietario-pozo-service.ts';

test('propiedad exclusiva: ID real positivo o nombre provisional normalizado', () => {
  assert.equal(normalizarPropiedad({id_propietario:null,propietario_provisional:'  Ana  '}),'Ana');
  assert.equal(normalizarPropiedad({id_propietario:8}),null);
  for(const data of [
    {id_propietario:null}, {id_propietario:null,propietario_provisional:'   '},
    {id_propietario:0}, {id_propietario:8,propietario_provisional:'Ana'},
    {id_propietario:null,propietario_provisional:'a'.repeat(161)},
  ]) assert.throws(()=>normalizarPropiedad(data));
});

test('vinculación verifica administración dentro del servicio y revierte sin escrituras',async()=>{
  const sql:string[]=[];
  const client={async query(q:string){sql.push(q);return{rows:[]};},release(){}};
  await assert.rejects(()=>vincularPropietarioPozo(1,2,null,3,{async connect(){return client;}} as never),{statusCode:403});
  assert.ok(sql.includes('ROLLBACK'));
  assert.ok(!sql.some(q=>q.startsWith('UPDATE')||q.startsWith('INSERT')||q.startsWith('DELETE')));
});
