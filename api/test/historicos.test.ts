import test from 'node:test';
import assert from 'node:assert/strict';
import { validarHistorico } from '../src/models/historicos.ts';

test('históricos no convierten números, no aceptan futuro ni fechas inventadas', () => {
  for(const numero of [undefined,null,0,-1,1.5,3282,2147483647,'3281',true,NaN,Infinity])
    assert.throws(()=>validarHistorico({numero_perforacion:numero}),{statusCode:400});
  for(const numero of [1,3001,3280,3281]) assert.doesNotThrow(()=>validarHistorico({numero_perforacion:numero}));
  assert.throws(()=>validarHistorico({numero_perforacion:3281,fecha_inicio:'2023-02-29'}));
  assert.throws(()=>validarHistorico({numero_perforacion:3281,origen:'normal'}));
  assert.throws(()=>validarHistorico({numero_perforacion:3281,id_propietario:2,propietario_provisional:'Otro'}));
});
