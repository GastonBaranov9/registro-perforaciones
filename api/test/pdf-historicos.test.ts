import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { PDFArray, PDFContentStream, PDFDocument } from "pdf-lib";
import { crearPDF } from "../src/pdf/pdf-generate.ts";
import { PerfilLitologicoInvalido } from "../src/pdf/perfil-litologico.ts";
import { myPool } from "../src/db/pool.ts";
import informes from "../src/routes/informes.ts";
import jwt from '../src/plugins/jwt.ts';
import cookies, { SESSION_COOKIE } from '../src/plugins/cookies.ts';
import { getReportePozo, type ReportePozo } from "../src/services/generar-informe-consultas.ts";

// Datos exclusivamente sintéticos. No se consulta PostgreSQL ni se leen fotos reales.
const idPozo = 90042;
function historico(cambios: Partial<ReportePozo> = {}): ReportePozo {
  return {
    id_pozo: idPozo, numero_perforacion: 123, origen: "historico",
    propietario: null, empresa: null, perforador: null, sitio: null, departamento: null,
    latitud: null, longitud: null, fecha_inicio: null, fecha_fin: null,
    profundidad_final_m: null, nivel_estatico_m: null, nivel_dinamico_m: null,
    caudal_estimado_lh: null, sello_sanitario: null, pre_filtro: null,
    metodo_sedimentario: null, metodo_rocoso: null, cementacion: null, desarrollo: null,
    revestimiento: null, introduccion: null, nombre_archivo: null, foto_url: null,
    litologia: [], diametros: [], filtros: [], niveles_aporte: [], ...cambios,
  };
}

function textoPDF(doc: PDFDocument): string {
  return doc.getPages().map((page) => {
    const contents = page.node.Contents() as PDFArray;
    return Array.from({ length: contents.size() }, (_, i) => {
      const stream = doc.context.lookup(contents.get(i)) as PDFContentStream;
      const operadores = Buffer.from(stream.getUnencodedContents()).toString("latin1");
      return [...operadores.matchAll(/<([0-9a-f]+)>\s*Tj/gi)]
        .map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("\n");
    }).join("\n");
  }).join("\n");
}

async function generar(reporte: ReportePozo) {
  return crearPDF(reporte, idPozo, { mapa: {}, directorioFotos: tmpdir() });
}

for (const [caso, propietario] of [
  ["vinculado", "Ana Vinculada"],
  ["provisional", "José Provisional"],
  ["ausente", null],
] as const) {
  test(`reporte y PDF de histórico parcial con propietario ${caso} no agregan leyenda de vinculación`, async () => {
    // Simula las filas de PostgreSQL; la expresión SQL y su prioridad se verifican
    // en reporte-pozo.test.ts, sin reproducir COALESCE dentro del mock.
    const fila = historico({ propietario });
    const db = { async query(sql: string, params: unknown[]) {
      if (sql.includes('SELECT origen FROM pozo')) return {rows:[{origen:'historico'}]};
    assert.deepEqual(params, [idPozo]);
      return { rows: sql.includes("FROM public.pozo p") ? [fila] : [] };
    } };
    const reporte = await getReportePozo(idPozo, db as never);
    assert.ok(reporte);
    assert.equal(reporte.propietario, propietario);
    assert.equal(reporte.perforador, null);
    assert.equal(reporte.profundidad_final_m, null);
    assert.doesNotMatch(JSON.stringify(reporte), /\(pendiente de vinculación\)/);

    const doc = await generar(reporte);
    const texto = textoPDF(doc);
    assert.equal(doc.getPageCount(), 3);
    assert.doesNotMatch(texto.replace(/\s+/g, " "), /pendiente de vinculación/);
    assert.match(texto, /Propietario\n/);
    assert.ok(texto.includes(`Propietario\n${propietario ?? "No especificado"}`));
    if (propietario !== null) {
      assert.equal(texto.split("\n").filter(linea => linea === propietario).length, 2,
        "El nombre aparece sin sufijo tanto en portada como en el resumen");
    } else {
      assert.doesNotMatch(texto, /\bnull\b|\bundefined\b/);
    }
    assert.match(texto, /Perforador\nNo especificado/);
    assert.match(texto, /Profundidad final\nNo especificado/);
    assert.ok((await doc.save()).length > 1000);
  });
}

test("histórico sin propietario genera PDF e identifica su origen sin inventar identidad", async () => {
  const entrada = historico({ profundidad_final_m: 30 });
  const original = structuredClone(entrada);
  const doc = await generar(entrada);
  const texto = textoPDF(doc);
  assert.match(texto, /Perforación histórica/);
  assert.match(texto, /Perforación Nº 123/);
  assert.match(texto, /Propietario\nNo especificado/);
  assert.match(texto, /Perforador\nNo especificado/);
  assert.doesNotMatch(texto, /\bnull\b|\bundefined\b/);
  assert.deepEqual(entrada, original);
  assert.ok((await doc.save()).length > 1000);
});

test("histórico sin profundidad ni litología conserva NULL y explica la ausencia del gráfico", async () => {
  const doc = await generar(historico());
  const texto = textoPDF(doc);
  assert.equal(doc.getPageCount(), 3);
  assert.match(texto.replace(/\n/g, " "), /No se puede representar el perfil litológico por falta de profundidad final/);
  for (const etiqueta of ["Profundidad final", "Nivel estático:", "Nivel dinámico:", "Caudal estimado:", "Prefiltro:"]) {
    assert.ok(texto.includes(`${etiqueta}\nNo especificado`), etiqueta);
  }
  assert.match(texto, /Fecha de inicio\nNo especificada/);
  assert.match(texto, /Coordenadas\nNo registradas/);
  assert.match(texto, /Sin registros/);
  assert.doesNotMatch(texto, /^0(?:[.,]0+)? (?:m|l\/h)$/m);
  assert.doesNotMatch(texto, /Perfil litológico del pozo/);
  assert.ok((await doc.save()).length > 1000);
});

test("litología sin profundidad conserva todas las tablas y omite únicamente el gráfico", async () => {
  const entrada = historico({
    litologia: [{ desde_m: 0, hasta_m: 12, material: "Arena sintética" }],
    diametros: [{ desde_m: 0, hasta_m: 10, diametro_pulg: 6, material_tuberia: "PVC" }],
    filtros: [{ desde_m: 8, hasta_m: 10, diametro_pulg: 6, material_tuberia: "PVC", ranura_mm: 0.5 }],
    niveles_aporte: [{ profundidad_m: 9 }],
  });
  const original = structuredClone(entrada);
  const doc = await generar(entrada);
  const texto = textoPDF(doc);
  for (const esperado of ["Intervalos litológicos", "Arena sintética", "12 m", "Tuberías y diámetros", "6 pulg", "Intervalos de filtro", "0.50 mm", "Niveles de aporte", "9 m"])
    assert.ok(texto.includes(esperado), esperado);
  assert.match(texto, /Profundidad final\nNo especificado/);
  assert.match(texto, /falta de profundidad final/);
  assert.doesNotMatch(texto, /Perfil litológico del pozo/);
  assert.equal(doc.getPageCount(), 3);
  assert.deepEqual(entrada, original, "No deducir profundidad de los intervalos ni modificar el reporte");
  assert.ok((await doc.save()).length > 1000);
});

test("foto ausente, referencia sin archivo y archivo ilegible tienen mensajes correctos", async () => {
  const directorio = await mkdtemp(join(tmpdir(), "pdf-historico-foto-"));
  const archivo = join(directorio, `pozo-${idPozo}.png`);
  const referencia = historico({ foto_url: `/usuarios/1/pozos/${idPozo}/foto` });
  try {
    const ausente = textoPDF(await crearPDF(historico(), idPozo, { mapa: {}, directorioFotos: directorio }));
    assert.match(ausente, /Fotografía no registrada/);
    assert.doesNotMatch(ausente, /registrada no disponible/);
    const faltante = textoPDF(await crearPDF(referencia, idPozo, { mapa: {}, directorioFotos: directorio }));
    assert.match(faltante, /Fotografía registrada no disponible/);
    await writeFile(archivo, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); // PNG truncado.
    const ilegible = textoPDF(await crearPDF(referencia, idPozo, { mapa: {}, directorioFotos: directorio }));
    assert.match(ilegible, /No se pudo leer o cargar el archivo/);
    assert.doesNotMatch(ilegible, /Fotografía no registrada/);
  } finally {
    await rm(archivo, { force: true });
    await rmdir(directorio);
  }
});

for (const valor of [true, false, null] as const) {
  test(`sello sanitario ${valor} y prefiltro se muestran desde sus propios campos`, async () => {
    const doc = await generar(historico({
      sello_sanitario: valor, pre_filtro: "Grava seleccionada", profundidad_final_m: 20,
      litologia: [{ desde_m: 0, hasta_m: 20, material: "Basalto" }],
    }));
    const texto = textoPDF(doc);
    if (valor === true) assert.match(texto.replace(/\s+/g, ' '), /Sello sanitario: Registrado en formato legado, sin profundidad especificada/);
    else assert.doesNotMatch(texto, /Sello sanitario/);
    assert.doesNotMatch(texto, /Elemento constructivo/);
    assert.match(texto, /Prefiltro:\nGrava seleccionada/);
  });
}

for (const profundidad of [null,20]) {
  test(`PDF muestra rango constructivo exacto con profundidad ${profundidad}`,async()=>{
    const doc=await generar(historico({profundidad_final_m:profundidad,sello_sanitario:true,sello_sanitario_constructivo:{desde_m:2.5,hasta_m:8.75}}));
    const texto=textoPDF(doc).replace(/\s+/g,' ');
    assert.match(texto,/Sello sanitario: Desde 2.5 m hasta 8.75 m/);
    assert.doesNotMatch(texto,/formato legado/);
    if(profundidad===null) {
      assert.doesNotMatch(texto,/Elemento constructivo/);
      assert.match(texto,/falta de profundidad final/);
    } else {
      assert.match(texto,/Elemento constructivo/);
      assert.match(texto,/Sello sanitario 2.5-8.75 m/);
    }
  });
}

test("pozo normal conserva perfil, fechas, número, valores conocidos y ceros reales", async () => {
  const doc = await generar(historico({
    origen: "normal", propietario: "Propietario de prueba", perforador: "Perforador de prueba",
    profundidad_final_m: 20, nivel_estatico_m: 0, nivel_dinamico_m: 3, caudal_estimado_lh: 0,
    fecha_inicio: new Date("2020-05-04T00:00:00Z"), fecha_fin: "2020-05-05",
    litologia: [{ desde_m: 0, hasta_m: 20, material: "Arena" }],
  }));
  const texto = textoPDF(doc);
  assert.equal(doc.getPageCount(), 4);
  assert.match(texto, /Perfil litológico del pozo/);
  assert.match(texto, /Profundidad final\n20 m/);
  assert.match(texto, /Nivel estático:\n0 m/);
  assert.match(texto, /Caudal estimado:\n0 l\/h/);
  assert.match(texto, /04\/05\/2020/);
  assert.match(texto, /05\/05\/2020/);
  assert.match(texto, /Perforación Nº 123/);
  assert.doesNotMatch(texto, /Perforación histórica|falta de profundidad final/);
});

test("una litología inconsistente con profundidad conocida conserva su validación", async () => {
  await assert.rejects(generar(historico({
    profundidad_final_m: 5, litologia: [{ desde_m: 0, hasta_m: 10, material: "Arena" }],
  })), PerfilLitologicoInvalido);
});

test("endpoint PDF principal responde 200 con un histórico parcial y SQL simulado", async (t) => {
  process.env.FASTIFY_SECRET = 'pdf-operador-test-never-production';
  let rol = 'operador_administrativo';
  const fila = historico({ litologia: [{ desde_m: 0, hasta_m: 12, material: "Arena" }] });
  t.mock.method(myPool, "connect", () => { throw new Error("Prohibido conectar a PostgreSQL"); });
  t.mock.method(myPool, "query", async (sql: string, params: unknown[]) => {
    if (sql.includes('SELECT activo, version_sesion')) return { rows: [{ activo: true, version_sesion: 1 }] };
    if (sql.includes('SELECT r.nombre FROM rol r')) { assert.deepEqual(params, [7]); return { rows: [{ nombre: rol }] }; }
    if (sql.includes('SELECT origen FROM pozo')) return {rows:[{origen:'historico'}]};
    if (sql.includes('FROM catalogo_litologia WHERE id_litologia = ANY')) return {rows:[{id_litologia:30,codigo:'sello_sanitario',nombre:'Identidad reservada',color:'#999999',patron:'concrete',activo:false}]};
    assert.deepEqual(params, [idPozo]);
    if (sql.includes("FROM public.pozo p")) {
      for (const campo of ["p.origen", "p.sello_sanitario", "p.pre_filtro", "public.sello_sanitario_pozo", "AS sello_sanitario_constructivo"]) assert.ok(sql.includes(campo));
      return { rows: [fila] };
    }
    if (sql.includes("FROM public.intervalo_litologico")) return { rows: fila.litologia };
    if (/FROM public\.(intervalo_diametro_perforacion|intervalo_filtro|nivel_aporte)\b/.test(sql)) return { rows: [] };
    throw new Error("Consulta no prevista en la prueba");
  });
  const app = Fastify();
  await app.register(cookies); await app.register(jwt);
  app.decorate('rateLimitPdf', async () => {});
  try {
    await app.register(informes);
    const credenciales = { [SESSION_COOKIE]: app.jwt.sign({ sub: 7, version_sesion: 1 }, { expiresIn: '1h' }) };
    const respuesta = await app.inject({ method: "GET", url: `/usuarios/1/pozos/${idPozo}/informe-pdf`, cookies: credenciales });
    assert.equal(respuesta.statusCode, 200, respuesta.body);
    assert.equal(respuesta.headers["content-type"], "application/pdf");
    assert.equal(respuesta.headers["content-disposition"], `attachment; filename="informe_pozo_${idPozo}.pdf"`);
    assert.equal(respuesta.rawPayload.subarray(0, 5).toString(), "%PDF-");
    assert.equal((await PDFDocument.load(respuesta.rawPayload)).getPageCount(), 3);
    rol = 'administracion';
    assert.equal((await app.inject({ method: 'GET', url: `/usuarios/1/pozos/${idPozo}/informe-pdf`, cookies: credenciales })).statusCode, 200);
    fila.profundidad_final_m = 20;
    fila.litologia = [{desde_m:0,hasta_m:20,material:'Basalto'}];
    fila.sello_sanitario_constructivo = {desde_m:2.5,hasta_m:8.75};
    const urlPerfil = `/usuarios/1/pozos/${idPozo}/perfil-litologico`;
    const persistido = await app.inject({method:'GET',url:urlPerfil,cookies:credenciales});
    assert.equal(persistido.statusCode,200,persistido.body);
    assert.equal(persistido.json().sello_sanitario_constructivo.texto,'Sello sanitario 2.5-8.75 m');
    for (const sello of [{desde_m:0,hasta_m:10},{desde_m:2.5,hasta_m:8.75},null]) {
      const preview = await app.inject({method:'POST',url:`${urlPerfil}/vista-previa`,cookies:credenciales,payload:{
        profundidad_final_m:20,intervalos_litologicos:fila.litologia,sello_sanitario_constructivo:sello,
      }});
      assert.equal(preview.statusCode,200,preview.body);
      assert.deepEqual(preview.json().tramos,persistido.json().tramos);
      if(sello) {
        assert.equal(preview.json().sello_sanitario_constructivo.desde_m,sello.desde_m);
        assert.equal(preview.json().sello_sanitario_constructivo.hasta_m,sello.hasta_m);
      } else assert.equal(preview.json().sello_sanitario_constructivo,null);
    }
    const invalido = await app.inject({method:'POST',url:`${urlPerfil}/vista-previa`,cookies:credenciales,payload:{profundidad_final_m:20,sello_sanitario_constructivo:{desde_m:0,hasta_m:21}}});
    assert.equal(invalido.statusCode,400,invalido.body);
    const reservado = await app.inject({method:'POST',url:`${urlPerfil}/vista-previa`,cookies:credenciales,payload:{profundidad_final_m:20,intervalos_litologicos:[{desde_m:0,hasta_m:10,material:'Identidad reservada',id_litologia:30}]}});
    assert.equal(reservado.statusCode,422,reservado.body);
    assert.match(reservado.body,/elemento constructivo/);
  } finally { await app.close(); }
});
