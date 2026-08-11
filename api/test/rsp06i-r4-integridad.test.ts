import assert from "node:assert/strict";
import test from "node:test";
import { myPool } from "../src/db/pool.ts";
import { crearPDFConDiagnostico } from "../src/pdf/pdf-generate.ts";
import { configuracionMapaDesdeEntorno, leerCoordenadas } from "../src/pdf/mapa-estatico.ts";
import { crearPozoCompleto, validarPozoCompleto } from "../src/services/pozo-completo-service.ts";
import { createSitio, updateSitio } from "../src/services/sitios-service.ts";
import type { ReportePozo } from "../src/services/generar-informe-consultas.ts";

function actualizacion(intervalos: Array<Record<string, unknown>>) {
  return {
    pozo: { id_propietario: 10, id_sitio: 20, id_perforador: 30, profundidad_final_m: 50 },
    intervalos_litologicos: intervalos,
    intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [], foto_accion: "conservar",
  } as never;
}

test("rechaza IDs litológicos persistidos duplicados antes de abrir la actualización", () => {
  const errores = validarPozoCompleto(actualizacion([
    { id_intervalo_litologico: 7, desde_m: 0, hasta_m: 10, material: "Arena" },
    { id_intervalo_litologico: 7, desde_m: 15, hasta_m: 25, material: "Roca" },
  ]));
  assert.ok(errores.some((mensaje) => mensaje.includes("id_intervalo_litologico")));
});

test("permite IDs distintos y nuevos sin identificador persistido", () => {
  assert.deepEqual(validarPozoCompleto(actualizacion([
    { id_intervalo_litologico: 7, desde_m: 0, hasta_m: 10, material: "Arena" },
    { id_intervalo_litologico: 8, desde_m: 15, hasta_m: 25, material: "Roca" },
    { desde_m: 30, hasta_m: 40, material: "Arcilla" },
  ])), []);
});

test("rechaza coordenadas vacías y conserva cero explícito normalizado", async () => {
  assert.equal(leerCoordenadas("   ", "0"), null);
  assert.equal(leerCoordenadas("\t", "0"), null);
  assert.deepEqual(leerCoordenadas(" 0.0 ", " 0 "), { latitud: 0, longitud: 0 });
  for (const valor of ["", "abc", "12foo", "91", "-91"]) assert.equal(leerCoordenadas(valor, "0"), null);
  assert.equal(leerCoordenadas("0", "181"), null);
  assert.equal(leerCoordenadas("0", "-181"), null);

  const consultas: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = myPool as typeof myPool & { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }> };
  const original = pool.query;
  pool.query = async (sql, params) => {
    consultas.push({ sql, params });
    if (sql.includes("UPDATE sitio")) return { rows: [{ id_sitio: 12, departamento: "Salto", latitud: "0", longitud: "0.0" }] };
    return { rows: [{ id_sitio: 12, departamento: "Salto", latitud: "0", longitud: "0.0" }] };
  };
  try {
    await assert.rejects(() => createSitio({ departamento: "Salto", latitud: "   ", longitud: "0" }), /coordenadas/i);
    const creado = await createSitio({ departamento: " Salto ", latitud: " 0 ", longitud: " 0.0 " });
    assert.equal(creado.id_sitio, 12);
    assert.deepEqual(consultas.at(-1)?.params?.slice(2), ["0", "0.0"]);
    await updateSitio(12, { departamento: " Salto ", latitud: " 0 ", longitud: " 0.0 " });
    assert.deepEqual(consultas.at(-1)?.params?.slice(3), ["0", "0.0"]);
  } finally { pool.query = original; }
});

test("la configuración canónica no vacía gana y la legacy cubre valores vacíos", () => {
  assert.deepEqual(configuracionMapaDesdeEntorno({
    MAP_STATIC_URL_TEMPLATE: " ", PDF_MAP_STATIC_URL_TEMPLATE: "https://legacy.example/{lat}/{lon}",
    MAP_STATIC_ALLOWED_HOST: " ", PDF_MAP_ALLOWED_HOST: "legacy.example",
    MAP_STATIC_API_KEY: " ", PDF_MAP_STATIC_API_KEY: "legacy-key",
    MAP_STATIC_ATTRIBUTION: " ", PDF_MAP_ATTRIBUTION: "Legacy",
  }), { plantillaUrl: "https://legacy.example/{lat}/{lon}", hostPermitido: "legacy.example", clave: "legacy-key", atribucion: "Legacy" });
  assert.equal(configuracionMapaDesdeEntorno({ MAP_STATIC_URL_TEMPLATE: "https://canonical.example/{lat}/{lon}", PDF_MAP_STATIC_URL_TEMPLATE: "https://legacy.example/{lat}/{lon}" }).plantillaUrl, "https://canonical.example/{lat}/{lon}");
});

test("campos generales extremos continúan en páginas técnicas sin perder tablas", async () => {
  const texto = "Descripción técnica extensa para forzar continuidad de campos generales. ".repeat(80);
  const reporte: ReportePozo = {
    id_pozo: 7404, propietario: "Control", empresa: "Control", perforador: "Control", sitio: "Salto", departamento: "Salto", localidad: "Centro",
    latitud: "-31", longitud: "-57", fecha_inicio: null, fecha_fin: null, profundidad_final_m: 20, nivel_estatico_m: null, nivel_dinamico_m: null,
    caudal_estimado_lh: null, metodo_sedimentario: texto, metodo_rocoso: texto, cementacion: texto, desarrollo: texto, introduccion: null,
    nombre_archivo: null, foto_url: null, litologia: [{ desde_m: 0, hasta_m: 20, material: "Arena" }],
    diametros: [{ desde_m: 0, hasta_m: 20, diametro_pulg: 6, material_tuberia: "PVC" }], filtros: [{ desde_m: 5, hasta_m: 10, diametro_pulg: 6, material_tuberia: "PVC" }], niveles_aporte: [{ profundidad_m: 8 }],
  };
  const { documento, diagnostico } = await crearPDFConDiagnostico(reporte, 7404, { mapa: {} });
  assert.ok(diagnostico.paginas.some((pagina) => pagina.bloques.includes("datos-generales-continuacion")));
  assert.ok(diagnostico.tablas.length === 4);
  assert.ok(diagnostico.tablas.every((tabla) => (tabla.fuente ?? 9) >= 9));
  assert.ok(documento.getPageCount() > 3);
});

test("coordenadas whitespace no abren transacción de pozo", () => {
  const data = {
    pozo: { id_propietario: 10, id_perforador: 30, profundidad_final_m: 10 },
    sitio_nuevo: { departamento: "Salto", latitud: " ", longitud: "0" }, intervalos_litologicos: [], intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
  } as never;
  assert.ok(validarPozoCompleto(data).some((mensaje) => mensaje.includes("coordenadas")));
  void crearPozoCompleto;
});
