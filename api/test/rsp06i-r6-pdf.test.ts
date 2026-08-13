import assert from "node:assert/strict";
import test from "node:test";
import { crearPDFConDiagnostico } from "../src/pdf/pdf-generate.ts";
import type { ReportePozo } from "../src/services/generar-informe-consultas.ts";

const GAP_ANTES_TITULO_TECNICO = 20;
const GAP_DESPUES_TITULO_TECNICO = 7;

function reporte(): ReportePozo {
  return {
    id_pozo: 606, propietario: "Control R6", empresa: "Empresa", perforador: "Perforador", sitio: "Salto",
    departamento: "Salto", localidad: "Salto", latitud: "-31", longitud: "-57", fecha_inicio: "2026-08-11",
    fecha_fin: "2026-08-11", profundidad_final_m: 100, nivel_estatico_m: 8, nivel_dinamico_m: 12,
    caudal_estimado_lh: 1500, metodo_sedimentario: "Rotación", metodo_rocoso: "Percusión", cementacion: "Sí",
    desarrollo: "Registrado", introduccion: null, nombre_archivo: null, foto_url: null,
    litologia: Array.from({ length: 5 }, (_, i) => ({ desde_m: i * 20, hasta_m: (i + 1) * 20, material: `Material ${i}` })),
    diametros: Array.from({ length: 3 }, (_, i) => ({ desde_m: i * 20, hasta_m: (i + 1) * 20, diametro_pulg: 8 - i, material_tuberia: "PVC" as const })),
    filtros: Array.from({ length: 2 }, (_, i) => ({ desde_m: 50 + i * 10, hasta_m: 55 + i * 10, diametro_pulg: 6, material_tuberia: "PVC" as const, ranura_mm: i ? null : 0.75 })),
    niveles_aporte: [{ profundidad_m: 60 }],
  };
}

test("R6 conserva mínimos visuales entre tablas y después del título", async () => {
  const { diagnostico } = await crearPDFConDiagnostico(reporte(), 606, { mapa: {} });
  const [litologia, tuberias, filtros] = diagnostico.tablas;
  assert.equal(diagnostico.paginas.filter((pagina) => pagina.tipo.startsWith("tecnica")).length, 1);
  assert.equal(litologia.paginas.at(-1), tuberias.paginaTitulo);
  assert.ok(litologia.bordeInferiorFinal - tuberias.tituloTop >= 10);
  assert.equal(tuberias.gapAntesTitulo, GAP_ANTES_TITULO_TECNICO);
  assert.equal(tuberias.paginas.at(-1), filtros.paginaTitulo);
  assert.ok(tuberias.bordeInferiorFinal - filtros.tituloTop >= 10);
  assert.equal(filtros.gapAntesTitulo, GAP_ANTES_TITULO_TECNICO);
  assert.ok(diagnostico.tablas.every((tabla) => tabla.tituloBottom - tabla.contenidoTop >= GAP_DESPUES_TITULO_TECNICO));
  assert.ok(diagnostico.tablas.every((tabla) => (tabla.fuente ?? 0) >= 9));
});

test("R6 conserva el mismo mínimo desde Sin registros hasta Niveles de aporte", async () => {
  const control = reporte(); control.filtros = [];
  const { diagnostico } = await crearPDFConDiagnostico(control, 606, { mapa: {} });
  const filtros = diagnostico.tablas.find((tabla) => tabla.titulo === "Intervalos de filtro")!;
  const aportes = diagnostico.tablas.find((tabla) => tabla.titulo === "Niveles de aporte")!;
  assert.equal(filtros.alturasFilas.length, 0);
  assert.equal(filtros.paginas.at(-1), aportes.paginaTitulo);
  assert.ok(filtros.bordeInferiorFinal - aportes.tituloTop >= 10);
  assert.equal(aportes.gapAntesTitulo, GAP_ANTES_TITULO_TECNICO);
});

test("R6 conserva casos pequeño, cargado, largo y continuación sin clipping tipográfico", async () => {
  const pequeno = reporte(); pequeno.litologia = pequeno.litologia.slice(0, 1); pequeno.diametros = []; pequeno.filtros = []; pequeno.niveles_aporte = [];
  const normal = await crearPDFConDiagnostico(pequeno, 606, { mapa: {} });
  assert.equal(normal.diagnostico.paginas.filter((pagina) => pagina.tipo.startsWith("tecnica")).length, 1);

  const cargado = reporte(); cargado.litologia = Array.from({ length: 12 }, (_, i) => ({ desde_m: i, hasta_m: i + 1, material: `Material técnico ${i}` }));
  cargado.diametros = Array.from({ length: 8 }, (_, i) => ({ desde_m: i, hasta_m: i + 1, diametro_pulg: 6, material_tuberia: "Acero" as const }));
  cargado.filtros = Array.from({ length: 6 }, (_, i) => ({ desde_m: i, hasta_m: i + .5, diametro_pulg: 6, material_tuberia: "PVC" as const, ranura_mm: i % 2 ? 0.5 : 1 }));
  const cargadoResultado = await crearPDFConDiagnostico(cargado, 606, { mapa: {} });
  assert.ok(cargadoResultado.diagnostico.tablas.every((tabla) => (tabla.fuente ?? 0) >= 9));
  assert.ok(cargadoResultado.diagnostico.tablas.every((tabla) => tabla.bordeInferiorFinal >= 52));

  const largo = reporte(); largo.metodo_sedimentario = "Descripción extensa ".repeat(90); largo.metodo_rocoso = "Otro campo extenso ".repeat(90);
  const largoResultado = await crearPDFConDiagnostico(largo, 606, { mapa: {} });
  assert.ok(largoResultado.diagnostico.paginas.every((pagina) => pagina.bloques.length > 0));

  const continuacion = reporte(); continuacion.litologia = Array.from({ length: 90 }, (_, i) => ({ desde_m: i, hasta_m: i + 1, material: `Material extenso ${i}` }));
  const continuacionResultado = await crearPDFConDiagnostico(continuacion, 606, { mapa: {} });
  assert.ok(continuacionResultado.diagnostico.paginas.filter((pagina) => pagina.tipo.startsWith("tecnica")).length > 1);
  assert.ok(continuacionResultado.diagnostico.paginas.every((pagina) => pagina.bloques.length > 0));
});
