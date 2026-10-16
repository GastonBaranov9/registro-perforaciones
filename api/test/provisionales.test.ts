import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarLitologiaProvisional } from '../src/services/litologia-provisional.ts';
import { validarHistorico } from '../src/models/historicos.ts';
import { listarPendientes } from '../src/services/pendientes-service.ts';

test('provisionales: trim, exclusión y ausencia histórica',()=>{
  assert.equal(normalizarLitologiaProvisional({litologia_provisional:' Arena arcillosa roja '}),'Arena arcillosa roja');
  assert.equal(normalizarLitologiaProvisional({id_litologia:1}),null);
  for(const litologia_provisional of ['', ' ', 'x'.repeat(161)])
    assert.throws(()=>normalizarLitologiaProvisional({litologia_provisional}),{statusCode:400});
  assert.throws(()=>normalizarLitologiaProvisional({id_litologia:1,litologia_provisional:'Arena'}),{statusCode:400});
  for(const datos of [{},{id_perforador:3},{perforador_provisional:'Alejandro Vanucci'}])
    assert.doesNotThrow(()=>validarHistorico({numero_perforacion:2100,...datos}));
  assert.throws(()=>validarHistorico({numero_perforacion:2100,id_perforador:3,perforador_provisional:'Alejandro Vanucci'}),{statusCode:400});
});

test('100 pendientes: dos consultas incluyendo autorización, agrupación exacta sin N+1 ni escrituras',async()=>{
  const queries:string[]=[];
  const db={query:async(sql:string)=>{
    queries.push(sql);
    if(sql.includes('SELECT r.nombre'))return {rows:[{nombre:'administracion'}]};
    return {rows:Array.from({length:100},(_,i)=>({tipo:i<50?'propietario':'perforador',texto:'Mismo nombre',id:i+1,id_pozo:i+1,numero_perforacion:2000+i,version:'12',version_pozo:'12'}))};
  }} as any;
  const grupos=await listarPendientes(1,false,db);
  assert.equal(queries.length,2);assert.equal(grupos.length,2);
  assert.deepEqual(grupos.map(g=>g.ocurrencias.length),[50,50]);
  assert.ok(queries.every(q=>!/(INSERT|UPDATE|DELETE)/.test(q)));
});
