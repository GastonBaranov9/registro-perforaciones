import assert from "node:assert/strict";
import test from "node:test";
import { PDFArray, PDFContentStream } from "pdf-lib";
import { validarNumeroPerforacion, traducirErrorNumeracion, obtenerNumeracion } from "../src/services/numeracion-perforacion-service.ts";
import { crearPDF } from "../src/pdf/pdf-generate.ts";
import type { ReportePozo } from "../src/services/generar-informe-consultas.ts";

test("solo admite enteros empresariales positivos dentro del rango PostgreSQL", () => {
  for (const numero of [1, 1850, 2047, 2147483647]) assert.doesNotThrow(() => validarNumeroPerforacion(numero));
  for (const numero of [0, -1, 1.5, NaN, Infinity, 2147483648, "2047", "", true, false, null, undefined])
    assert.throws(() => validarNumeroPerforacion(numero), { statusCode: 400 });
});
test("duplicados reales y contador sin configurar producen conflictos identificables", () => {
  for (const error of [
    { code: "23505", constraint: "pozo_numero_perforacion_uq" },
    { code: "23505", constraint: "numero_perforacion_reservado_pkey" },
    { code: "P1100" }, { code: "P1102" }, { code: "P1103" },
  ]) assert.equal((traducirErrorNumeracion(error) as { statusCode: number }).statusCode, 409);
  const ajeno = { code: "23505", constraint: "usuario_email_key" };
  assert.equal(traducirErrorNumeracion(ajeno), ajeno);
});

test('rango entero independiente de cursor y mayor; disponibilidad se revisa por política', async () => {
  for (const [proximo, mayor_asignado] of [
    [null, 0], [null, 2100], [null, 3281],
    [2101, 2100], [3282, 3281], [5000, 3282],
    [null, 5000], [2147483648, 2147483647],
  ] as const) {
    const db = { query: async (sql:string) => ({ rows: sql.includes('autorizacion_numeracion')?[]:[{ proximo, mayor_asignado }] }) };
    assert.deepEqual(await obtenerNumeracion(1, db as never), {
      proximo, minimo:1, agotado: proximo!==null&&proximo > 2147483647,puede_retroceder:false,
    });
  }
});

function reporte(numero?: number | null): ReportePozo {
  return {
    id_pozo: 12, numero_perforacion: numero, propietario: "Propietario", empresa: "Empresa",
    perforador: "Perforador", sitio: "Salto", fecha_inicio: null, fecha_fin: null,
    profundidad_final_m: 30, nivel_estatico_m: null, nivel_dinamico_m: null, caudal_estimado_lh: null,
    metodo_sedimentario: null, metodo_rocoso: null, cementacion: null, desarrollo: null,
    introduccion: null, nombre_archivo: null, foto_url: null,
    litologia: [{ desde_m: 0, hasta_m: 5, material: "Arcilla" }, { desde_m: 5, hasta_m: 30, material: "Basalto" }],
    diametros: [], niveles_aporte: [], filtros: [],
  };
}
for (const numero of [2047, null, undefined]) {
  test("PDF distingue número empresarial e ID interno: " + numero, async () => {
    const entrada = reporte(numero), original = structuredClone(entrada);
    const doc = await crearPDF(entrada, 12, { mapa: {} });
    const contents = doc.getPage(0).node.Contents() as PDFArray;
    let texto = "";
    for (let i = 0; i < contents.size(); i++) {
      const stream = doc.context.lookup(contents.get(i)) as PDFContentStream;
      const operadores = Buffer.from(stream.getUnencodedContents()).toString("latin1");
      texto += [...operadores.matchAll(/<([0-9a-f]+)>\s*Tj/gi)].map(m => Buffer.from(m[1], "hex").toString("latin1")).join("\n");
    }
    assert.match(texto, numero == null ? /Perforación sin número asignado/ : /Perforación Nº 2047/);
    assert.match(texto, /ID interno: 12/);
    assert.doesNotMatch(texto, /Pozo Nº 12|Perforación Nº 12/);
    assert.deepEqual(entrada, original, "La generación no altera las capas ni profundidades");
    assert.ok((await doc.save()).length > 3000);
  });
}
