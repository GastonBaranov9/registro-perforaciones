import test from 'node:test';
import assert from 'node:assert/strict';
import { validarHistorico, validarEdicionHistorica } from '../src/models/historicos.ts';
import { DATOS_TECNICOS_ESTANDAR } from '../src/constants/datos-tecnicos-estandar.ts';

test('históricos admiten estándares explícitos, textos propios y desconocidos sin introducir defaults', () => {
  const parcial = { numero_perforacion: 3281 };
  validarHistorico(parcial);
  assert.deepEqual(parcial, { numero_perforacion: 3281 });
  assert.doesNotThrow(() => validarHistorico({ ...parcial, ...DATOS_TECNICOS_ESTANDAR }));
  assert.doesNotThrow(() => validarEdicionHistorica({ ...DATOS_TECNICOS_ESTANDAR }));
  const nulos = Object.fromEntries(Object.keys(DATOS_TECNICOS_ESTANDAR).map(campo => [campo, null]));
  validarEdicionHistorica(nulos);
  assert.ok(Object.values(nulos).every(valor => valor === null));
  for (const campo of Object.keys(DATOS_TECNICOS_ESTANDAR)) {
    assert.doesNotThrow(() => validarHistorico({ ...parcial, [campo]: 'Texto documentado' }));
    assert.doesNotThrow(() => validarEdicionHistorica({ [campo]: 'Texto documentado' }));
    // El contrato vigente representa vacío como omisión al crear y NULL al editar.
    assert.throws(() => validarHistorico({ ...parcial, [campo]: '' }));
    assert.throws(() => validarEdicionHistorica({ [campo]: '' }));
  }
});

test('origen histórico independiente del número; sin conversiones ni fechas inventadas', () => {
  for(const numero of [undefined,0,-1,1.5,2147483648,'3281',true,NaN,Infinity])
    assert.throws(()=>validarHistorico({numero_perforacion:numero}),{statusCode:400});
  for(const numero of [null,1,3001,3280,3281,3282,9000,2147483647]) assert.doesNotThrow(()=>validarHistorico({numero_perforacion:numero}));
  assert.throws(()=>validarHistorico({numero_perforacion:3281,fecha_inicio:'2023-02-29'}));
  assert.throws(()=>validarHistorico({numero_perforacion:3281,origen:'normal'}));
  assert.throws(()=>validarHistorico({numero_perforacion:3281,id_propietario:2,propietario_provisional:'Otro'}));
});

test('edición histórica estricta: sólo datos mutables, null explícito y acciones de foto coherentes',()=>{
  for(const key of ['numero_perforacion','origen','id_pozo','creado_por','id_sitio','reserva'])
    assert.throws(()=>validarEdicionHistorica({[key]:key==='origen'?'historico':3281}),{statusCode:400});
  assert.doesNotThrow(()=>validarEdicionHistorica({empresa:null,id_propietario:null,nivel_estatico_m:0}));
  assert.throws(()=>validarEdicionHistorica({nivel_estatico_m:'2'}),{statusCode:400});
  assert.throws(()=>validarEdicionHistorica({foto_accion:'reemplazar'}),{statusCode:400});
  assert.throws(()=>validarEdicionHistorica({foto_accion:'conservar',foto:{mime_type:'image/png',base64:'abcd'}}),{statusCode:400});
});
