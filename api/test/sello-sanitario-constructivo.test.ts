import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { PozoCompletoBody, PozoCompletoUpdateBody, PozoDetalle } from '../src/models/schemas.ts';
import { validarHistorico, validarEdicionHistorica } from '../src/models/historicos.ts';
import { validarSelloSanitario } from '../src/services/sello-sanitario-service.ts';
import { validarPozoCompleto } from '../src/services/pozo-completo-service.ts';
import { normalizarLitologiaProvisional, provisionalParaIntervaloNuevo, exigirLitologiaNoConstructiva } from '../src/services/litologia-provisional.ts';

const sello = { desde_m: 1.25, hasta_m: 9.875 };
const cuerpo = {
  pozo: { id_propietario: 2, id_perforador: 3, profundidad_final_m: 30 },
  sitio_nuevo: { departamento: 'Salto', latitud: '-31', longitud: '-57' },
  intervalos_litologicos: [{ desde_m: 0, hasta_m: 30, material: 'Basalto', id_litologia: 1 }],
  intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
};

test('contrato constructivo separado del booleano legado y opcional sin defaults', async () => {
  const app = Fastify();
  app.post('/alta', { schema: { body: PozoCompletoBody } }, async request => request.body);
  app.put('/edicion', { schema: { body: PozoCompletoUpdateBody } }, async request => request.body);
  try {
    for (const valor of [undefined, null, sello]) {
      const alta = { ...cuerpo, ...(valor === undefined ? {} : { sello_sanitario_constructivo: valor }) };
      const respuestaAlta = await app.inject({ method: 'POST', url: '/alta', payload: alta });
      assert.equal(respuestaAlta.statusCode, 200, respuestaAlta.body);
      assert.deepEqual(respuestaAlta.json().sello_sanitario_constructivo, valor);
      assert.deepEqual(validarPozoCompleto(alta), []);
      validarHistorico({ numero_perforacion: 2100, ...(valor === undefined ? {} : { sello_sanitario_constructivo: valor }) });
      validarEdicionHistorica({ empresa: 'Prueba', ...(valor === undefined ? {} : { sello_sanitario_constructivo: valor }) });
      const { sitio_nuevo: sitio, ...edicion } = alta;
      const respuestaEdicion = await app.inject({ method: 'PUT', url: '/edicion', payload: { ...edicion, pozo: { ...edicion.pozo, id_sitio: 1 }, foto_accion: 'conservar' } });
      assert.equal(respuestaEdicion.statusCode, 200, respuestaEdicion.body);
      assert.deepEqual(respuestaEdicion.json().sello_sanitario_constructivo, valor);
    }
    assert.equal(Object.hasOwn(cuerpo, 'sello_sanitario_constructivo'), false);
    assert.ok(JSON.stringify(PozoDetalle).includes('sello_sanitario_constructivo'));
  } finally { await app.close(); }
});

test('sello admite cero, inicio distinto de cero, decimales y profundidad desconocida', () => {
  for (const profundidad of [undefined, null, 9.875, 30])
    assert.doesNotThrow(() => validarSelloSanitario(sello, profundidad));
  assert.doesNotThrow(() => validarSelloSanitario({ desde_m: 0, hasta_m: 0.001 }, 1));
});

test('rangos inválidos, valores no finitos, coerciones y exceso se rechazan', () => {
  for (const dato of [
    { desde_m: -1, hasta_m: 2 }, { desde_m: 2, hasta_m: 2 }, { desde_m: 3, hasta_m: 2 },
    { desde_m: NaN, hasta_m: 2 }, { desde_m: 0, hasta_m: Infinity },
    { desde_m: '0', hasta_m: 2 }, { desde_m: 0 }, { ...sello, inventado: true },
  ]) {
    assert.throws(() => validarSelloSanitario(dato as never), { statusCode: 400 });
  }
  assert.throws(() => validarSelloSanitario(sello, 9), /excede la profundidad final/);
  assert.ok(validarPozoCompleto({ ...cuerpo, sello_sanitario_constructivo: { desde_m: 1, hasta_m: 31 } }).some(texto => texto.includes('excede')));
});

test('identidades reservadas se rechazan con trim y sin distinguir mayúsculas', () => {
  for (const texto of ['Sello sanitario', 'sello sanitario', 'SELLO SANITARIO', 'sello_sanitario', 'SELLO_SANITARIO', ' \tSeLLo SaNiTaRiO\n']) {
    assert.throws(() => normalizarLitologiaProvisional({ litologia_provisional: texto }), /elemento constructivo/);
    assert.throws(() => provisionalParaIntervaloNuevo({ material: texto }), /elemento constructivo/);
    assert.ok(validarPozoCompleto({ ...cuerpo, intervalos_litologicos: [{ desde_m: 0, hasta_m: 1, material: texto }] }).length);
  }
});

test('nombres distintos se permiten sin quitar tildes ni aproximar palabras, prefijos o sufijos', () => {
  for (const texto of ['Sello sanitario antiguo', 'Material tipo sello', 'Prefijo Sello sanitario', 'Sello sanitario similar', 'Séllo sanitario', 'sello  sanitario', 'Sello sanitariо', 'Arena']) {
    assert.equal(provisionalParaIntervaloNuevo({ material: texto }), texto);
    assert.equal(normalizarLitologiaProvisional({ litologia_provisional: texto }), texto);
  }
});

test('id canónico se rechaza independientemente de activo, pero otros ids siguen admitidos', async () => {
  const consultas: string[] = [];
  const db = { async query(sql: string, params: unknown[]) {
    consultas.push(sql);
    return { rows: [{ codigo: params[0] === 30 ? 'sello_sanitario' : 'basalto_marron' }] };
  } };
  await assert.rejects(exigirLitologiaNoConstructiva(db as never, 30), /id_litologia/);
  await assert.doesNotReject(exigirLitologiaNoConstructiva(db as never, 1));
  await assert.doesNotReject(exigirLitologiaNoConstructiva(db as never, undefined));
  assert.equal(consultas.length, 2);
  assert.ok(consultas.every(sql => !sql.includes('activo')));
});
