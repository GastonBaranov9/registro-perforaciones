import assert from "node:assert/strict";
import test from "node:test";
import { getReportePozo } from "../src/services/generar-informe-consultas.ts";
import { generarPDFBytes } from "../src/pdf/pdf-generate.ts";

test("convierte NUMERIC de PostgreSQL antes de generar perfil y PDF", async () => {
  const respuestas = [
    [{ id_pozo: "7", propietario: "P", empresa: "E", perforador: "R", sitio: "S", profundidad_final_m: "40.5", nivel_estatico_m: "3.2", nivel_dinamico_m: null, caudal_estimado_lh: "500", foto_url: null }],
    [{ desde_m: "0", hasta_m: "10.5", material: "Arena" }, { desde_m: "15", hasta_m: "30", material: "Roca" }],
    [{ desde_m: "0", hasta_m: "40.5", diametro_pulg: "8" }],
    [{ profundidad_m: "18" }],
  ];
  const db = { async query() { return { rows: respuestas.shift() ?? [] }; } };
  const reporte = await getReportePozo(7, db as never);
  assert.ok(reporte);
  assert.equal(reporte.profundidad_final_m, 40.5);
  assert.equal(reporte.litologia[0].hasta_m, 10.5);
  assert.equal(reporte.diametros[0].diametro_pulg, 8);
  assert.equal(reporte.niveles_aporte[0].profundidad_m, 18);
  assert.ok((await generarPDFBytes(reporte, 7)).length > 1_000);
});

test("PDF posterior a eliminar foto no intenta cargar archivo", async () => {
  const reporte = {
    id_pozo: 8, propietario: "P", empresa: "E", perforador: "R", sitio: "S",
    fecha_inicio: null, fecha_fin: null, profundidad_final_m: 20, nivel_estatico_m: null,
    nivel_dinamico_m: null, caudal_estimado_lh: null, metodo_sedimentario: null,
    metodo_rocoso: null, cementacion: null, desarrollo: null, introduccion: null,
    nombre_archivo: null, foto_url: null,
    litologia: [{ desde_m: 0, hasta_m: 8, material: "Arena" }],
    diametros: [{ desde_m: 0, hasta_m: 20, diametro_pulg: 6 }],
    niveles_aporte: [{ profundidad_m: 12 }],
  };
  assert.ok((await generarPDFBytes(reporte, 8)).length > 1_000);
});
