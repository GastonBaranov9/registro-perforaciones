import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { DOMParser } from '@xmldom/xmldom';
import { generarKml, type PerforacionKml } from '../src/services/exportar-kml-service.ts';
import { myPool } from '../src/db/pool.ts';
import cookies, { SESSION_COOKIE } from '../src/plugins/cookies.ts';
import jwt from '../src/plugins/jwt.ts';
import cors from '../src/plugins/cors.ts';
import pozos from '../src/routes/pozos.ts';

const base: PerforacionKml = {
  numero_perforacion: 2047, propietario: 'José Pérez', fecha_inicio: '2020-02-29',
  fecha_fin: '2020-03-02', profundidad_final_m: '42.50', caudal_estimado_lh: 2500,
  departamento: 'Río Negro', localidad: 'Paso de los Mellizos', latitud: '-32.5', longitud: '-57.25',
};

function xml(contenido: string) {
  return new DOMParser({ onError: (nivel, mensaje) => {
    // U+FFFD es XML válido y se usa deliberadamente para controles inválidos.
    if (nivel === 'warning' && mensaje === 'Unicode replacement character detected, source encoding issues?') return;
    throw new Error(`${nivel}: ${mensaje}`);
  } })
    .parseFromString(contenido, 'application/xml');
}

test('KML 2.2 válido, nombre empresarial, longitud antes de latitud y datos registrados con unidades', () => {
  const resultado = generarKml([base]);
  const doc = xml(resultado.kml);
  assert.equal(doc.documentElement!.namespaceURI, 'http://www.opengis.net/kml/2.2');
  assert.equal(doc.getElementsByTagName('Placemark').length, 1);
  const punto = doc.getElementsByTagName('Placemark')[0];
  assert.equal(punto.getElementsByTagName('name')[0].textContent, 'P-2047');
  assert.equal(punto.getElementsByTagName('coordinates')[0].textContent, '-57.25,-32.5,0');
  const descripcion = punto.getElementsByTagName('description')[0].textContent!;
  for (const dato of ['2047', 'José Pérez', '29/02/2020', '02/03/2020', '42.50 m', '2500 l/h', 'Río Negro', 'Paso de los Mellizos', '-32.5', '-57.25'])
    assert.ok(descripcion.includes(dato), dato);
  assert.equal(resultado.exportadas, 1);
  assert.equal(resultado.omitidas, 0);
  assert.equal(doc.getElementsByTagName('NetworkLink').length, 0);
});

test('escapa &, <, >, ambas comillas y evita interpretar datos como HTML en Google Earth', () => {
  const especial = `José & <b>"Ana"</b> > 'Sur' ]]>`;
  const { kml } = generarKml([{ ...base, propietario: especial, departamento: especial, localidad: especial }]);
  const doc = xml(kml);
  assert.equal(doc.getElementsByTagName('Folder')[0].getElementsByTagName('name')[0].textContent, especial);
  const html = doc.getElementsByTagName('description')[0].textContent!;
  const tabla = xml(html);
  assert.equal(tabla.getElementsByTagName('td')[1].textContent, especial);
  assert.equal(tabla.getElementsByTagName('b').length, 0);
  for (const entidad of ['&amp;', '&lt;', '&gt;', '&quot;', '&apos;']) assert.ok(html.includes(entidad), entidad);
});

test('reemplaza caracteres prohibidos en XML 1.0 y conserva Unicode', () => {
  const doc = xml(generarKml([{ ...base, propietario: 'Raúl 💧\u0000\u000B\uD800\uFFFE' }]).kml);
  assert.ok(doc.getElementsByTagName('description')[0].textContent!.includes('Raúl 💧����'));
});

test('agrupa puntos por departamento y usa Sin departamento para NULL o vacío', () => {
  const doc = xml(generarKml([
    base, { ...base, numero_perforacion: 2048 },
    { ...base, departamento: 'Salto' }, { ...base, departamento: null }, { ...base, departamento: '  ' },
  ]).kml);
  const carpetas = Array.from(doc.getElementsByTagName('Folder'));
  assert.deepEqual(carpetas.map(c => [c.getElementsByTagName('name')[0].textContent, c.getElementsByTagName('Placemark').length]),
    [['Río Negro', 2], ['Salto', 1], ['Sin departamento', 2]]);
});

test('omite coordenadas faltantes, fuera de rango y valores no decimales sin coerciones a cero', () => {
  const invalidas = [null, undefined, '', ' ', 'abc', '34sur', '0x10', 'Infinity', 'NaN', NaN, Infinity, true, [], {}, '1,5', '1e1', '32° 30\' 0" S'];
  const filas = invalidas.flatMap(valor => [{ ...base, latitud: valor }, { ...base, longitud: valor }]);
  filas.push(...[
    { ...base, latitud: -90.001 }, { ...base, latitud: '90.001' },
    { ...base, longitud: -180.001 }, { ...base, longitud: '180.001' },
  ]);
  const { kml, exportadas, omitidas } = generarKml(filas);
  assert.equal(exportadas, 0);
  assert.equal(omitidas, filas.length);
  assert.equal(xml(kml).getElementsByTagName('Placemark').length, 0);
});

test('acepta límites inclusivos, cero, signo y espacios externos en coordenadas decimales', () => {
  const resultado = generarKml([
    { ...base, latitud: -90, longitud: -180 }, { ...base, latitud: ' +90 ', longitud: '+180' },
    { ...base, latitud: '0', longitud: '-0' },
  ]);
  assert.equal(resultado.exportadas, 3);
  assert.equal(resultado.omitidas, 0);
  assert.deepEqual(Array.from(xml(resultado.kml).getElementsByTagName('coordinates')).map(p => p.textContent),
    ['-180,-90,0', '180,90,0', '0,0,0']);
});

test('no inventa propietario, fechas ni datos técnicos faltantes; el caudal cero se conserva', () => {
  const { kml } = generarKml([{ ...base, propietario: null, fecha_inicio: null,
    fecha_fin: null, profundidad_final_m: null, caudal_estimado_lh: null, departamento: null, localidad: null }]);
  const doc = xml(kml);
  assert.equal(doc.getElementsByTagName('Placemark')[0].getElementsByTagName('name')[0].textContent, 'P-2047');
  const tabla = xml(doc.getElementsByTagName('description')[0].textContent!);
  assert.deepEqual(Array.from(tabla.getElementsByTagName('td')).map(c => c.textContent),
    ['2047', 'No registrado', 'No especificada', 'No especificada', 'No registrado', 'No registrado', 'No registrado', 'No registrado', '-32.5', '-57.25']);
  assert.ok(generarKml([{ ...base, caudal_estimado_lh: 0 }]).kml.includes('0 l/h'));
});

test('omite números comerciales faltantes o inválidos, sin coerciones ni nombres inventados', () => {
  const invalidos = [null, undefined, 0, -1, 1.5, NaN, Infinity, -Infinity, 2147483648, Number.MAX_SAFE_INTEGER, '', '2047', 'abc', true, {}, []];
  const resultado = generarKml(invalidos.map(numero_perforacion => ({ ...base, numero_perforacion })));
  assert.equal(resultado.exportadas, 0);
  assert.equal(resultado.omitidas, invalidos.length);
  assert.equal(resultado.omitidasPorNumero, invalidos.length);
  assert.equal(resultado.omitidasPorCoordenadas, 0);
  assert.equal(xml(resultado.kml).getElementsByTagName('Placemark').length, 0);
  assert.ok(!resultado.kml.includes('P-No registrado'));
});

test('conserva números comerciales en ambos límites y cuenta una sola vez cada omisión', () => {
  const resultado = generarKml([
    { ...base, numero_perforacion: 1 }, { ...base, numero_perforacion: 2147483647 },
    { ...base, latitud: null }, { ...base, numero_perforacion: null },
    { ...base, numero_perforacion: null, longitud: null },
  ]);
  assert.equal(resultado.exportadas, 2);
  assert.equal(resultado.omitidas, 3);
  assert.equal(resultado.omitidasPorCoordenadas, 2);
  assert.equal(resultado.omitidasPorNumero, 1);
  assert.deepEqual(Array.from(xml(resultado.kml).getElementsByTagName('Placemark'))
    .map(p => p.getElementsByTagName('name')[0].textContent), ['P-1', 'P-2147483647']);
});

test('sin perforaciones devuelve un documento válido y ambos contadores en cero', () => {
  const resultado = generarKml([]);
  assert.equal(resultado.exportadas, 0);
  assert.equal(resultado.omitidas, 0);
  assert.equal(xml(resultado.kml).getElementsByTagName('Document').length, 1);
});

test('endpoint real: autenticación, permiso administrativo, descarga fresca, headers y CORS; sin PostgreSQL', async t => {
  const secretAnterior = process.env.FASTIFY_SECRET;
  const corsAnterior = process.env.CORS_ORIGINS;
  process.env.FASTIFY_SECRET = 'test-kml-secret-never-production-32-characters';
  process.env.CORS_ORIGINS = 'https://portal.example.test';
  t.after(() => {
    if (secretAnterior === undefined) delete process.env.FASTIFY_SECRET; else process.env.FASTIFY_SECRET = secretAnterior;
    if (corsAnterior === undefined) delete process.env.CORS_ORIGINS; else process.env.CORS_ORIGINS = corsAnterior;
  });
  // Cualquier intento de abrir una conexión real falla inmediatamente.
  t.mock.method(myPool, 'connect', () => { throw new Error('Prohibida conexión real'); });
  let roles: string[] = [];
  let lecturas = 0;
  let filas = [base, { ...base, latitud: null }, { ...base, numero_perforacion: null },
    { ...base, numero_perforacion: null, longitud: null }];
  t.mock.method(myPool, 'query', async (sql: string, params: unknown[]) => {
    if (sql.includes('SELECT activo, version_sesion')) return { rows: [{ activo: true, version_sesion: 1 }] };
    if (sql.includes('FROM usuario_rol')) {
      assert.deepEqual(params, [7, 'administracion']);
      return { rows: roles.includes(String(params[1])) ? [{}] : [] };
    }
    assert.match(sql, /^\s*SELECT /);
    assert.match(sql, /LEFT JOIN public\.usuario u ON u\.id_usuario = p\.id_propietario/);
    assert.match(sql, /LEFT JOIN public\.sitio s ON s\.id_sitio = p\.id_sitio/);
    assert.match(sql, /p\.propietario_provisional/);
    assert.match(sql, /to_char\(p\.fecha_fin, 'YYYY-MM-DD'\)/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|WHERE|LIMIT|nextval|fecha_creado)\b/i);
    lecturas++;
    return { rows: filas };
  });
  const app = Fastify();
  t.after(() => app.close());
  await app.register(cookies);
  await app.register(jwt);
  await app.register(cors);
  await app.register(pozos);
  await app.ready();
  const token = app.jwt.sign({ sub: 7, version_sesion: 1 }, { expiresIn: '1h' });
  const peticion = { method: 'GET' as const, url: '/pozos/exportar/kml', cookies: { [SESSION_COOKIE]: token }, headers: { origin: 'https://portal.example.test' } };
  await t.test('sin sesión recibe 401', async () => {
    assert.equal((await app.inject({ method: 'GET', url: peticion.url })).statusCode, 401);
  });
  for (const caso of [['perforador'], ['propietario'], ['perforador', 'propietario'], []]) {
    await t.test(`${caso.join('+') || 'sin rol'} recibe 403 sin leer perforaciones`, async () => {
      roles = caso;
      const respuesta = await app.inject(peticion);
      assert.equal(respuesta.statusCode, 403);
      assert.equal(lecturas, 0);
      assert.equal(respuesta.headers['content-disposition'], undefined);
      assert.ok(!respuesta.body.includes('José'));
    });
  }
  for (const caso of [['administracion'], ['administracion', 'perforador', 'propietario']]) {
    await t.test(`${caso.join('+')} descarga KML con contadores`, async () => {
      roles = caso;
      const respuesta = await app.inject(peticion);
      assert.equal(respuesta.statusCode, 200, respuesta.body);
      assert.equal(respuesta.headers['content-type'], 'application/vnd.google-earth.kml+xml');
      assert.equal(respuesta.headers['content-disposition'], 'attachment; filename="perforaciones-raulsilva.kml"');
      assert.equal(respuesta.headers['cache-control'], 'no-store');
      assert.equal(respuesta.headers['x-kml-exportadas'], '1');
      assert.equal(respuesta.headers['x-kml-omitidas'], '3');
      assert.equal(respuesta.headers['access-control-expose-headers'] ?? '', '');
      assert.equal(respuesta.headers['access-control-allow-origin'], 'https://portal.example.test');
      assert.equal(xml(respuesta.body).getElementsByTagName('Placemark').length, 1);
    });
  }
  await t.test('cada descarga refleja una lectura nueva, incluso si queda vacía', async () => {
    filas = [];
    const respuesta = await app.inject(peticion);
    assert.equal(lecturas, 3);
    assert.equal(respuesta.headers['x-kml-exportadas'], '0');
    assert.equal(respuesta.headers['x-kml-omitidas'], '0');
    assert.equal(xml(respuesta.body).getElementsByTagName('Placemark').length, 0);
  });
  await t.test('CORS no autoriza origins adicionales ni wildcard para la exportación', async () => {
    const respuesta = await app.inject({ method: 'OPTIONS', url: peticion.url, headers: {
      origin: 'https://otro.example.test', 'access-control-request-method': 'GET',
    } });
    assert.equal(respuesta.headers['access-control-allow-origin'], undefined);
    assert.equal(respuesta.headers['access-control-expose-headers'] ?? '', '');
    assert.equal(lecturas, 3);
  });
});
