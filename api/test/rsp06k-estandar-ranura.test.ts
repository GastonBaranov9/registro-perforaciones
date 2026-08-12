import assert from "node:assert/strict";
import test from "node:test";
import { DATOS_TECNICOS_ESTANDAR, datosTecnicosParaCreacion } from "../src/constants/datos-tecnicos-estandar.ts";
import { validarPozoCompleto } from "../src/services/pozo-completo-service.ts";
import { formatearRanuraFiltro } from "../src/pdf/pdf-generate.ts";
import type { PozoCompletoBody, PozoCompletoUpdateBody } from "../src/models/schemas.ts";

const base = (): PozoCompletoBody => ({
  pozo: { id_propietario: 1, id_perforador: 2, profundidad_final_m: 30 },
  sitio_nuevo: { departamento: "Salto", latitud: "-31", longitud: "-57" },
  intervalos_litologicos: [], intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
});

test("los cuatro defaults canónicos se aplican solo a campos omitidos", () => {
  assert.deepEqual(datosTecnicosParaCreacion({}), DATOS_TECNICOS_ESTANDAR);
  const personalizado = datosTecnicosParaCreacion({ desarrollo: "Desarrollo histórico particular" });
  assert.equal(personalizado.desarrollo, "Desarrollo histórico particular");
  assert.equal(personalizado.cementacion, DATOS_TECNICOS_ESTANDAR.cementacion);
  assert.throws(() => datosTecnicosParaCreacion({ desarrollo: "   " }), /no puede estar vacío/);
});

test("creación exige ranura permitida y rechaza faltantes o valores ajenos", () => {
  for (const ranura_mm of [0.5, 0.75, 1] as const) {
    const data = base(); data.intervalos_filtro = [{ desde_m: 10, hasta_m: 20, diametro_pulg: 6, material_tuberia: "PVC", ranura_mm }];
    assert.deepEqual(validarPozoCompleto(data), []);
  }
  const faltante = base(); faltante.intervalos_filtro = [{ desde_m: 10, hasta_m: 20, diametro_pulg: 6, material_tuberia: "PVC" } as never];
  assert.ok(validarPozoCompleto(faltante).some((mensaje) => mensaje.includes("ranura es obligatoria")));
  const invalido = base(); invalido.intervalos_filtro = [{ desde_m: 10, hasta_m: 20, diametro_pulg: 6, material_tuberia: "PVC", ranura_mm: 0.6 as 0.5 }];
  assert.ok(validarPozoCompleto(invalido).some((mensaje) => mensaje.includes("ranura inválida")));
});

test("un filtro histórico persistido conserva ranura NULL y uno nuevo no", () => {
  const data: PozoCompletoUpdateBody = {
    pozo: { id_propietario: 1, id_perforador: 2, profundidad_final_m: 30 }, foto_accion: "conservar",
    intervalos_litologicos: [], intervalos_diametro: [], niveles_aporte: [],
    intervalos_filtro: [{ id_intervalo_filtro: 8, desde_m: 10, hasta_m: 20, diametro_pulg: 6, material_tuberia: "PVC", ranura_mm: null }],
  };
  assert.deepEqual(validarPozoCompleto(data), []);
  delete data.intervalos_filtro[0].id_intervalo_filtro;
  assert.ok(validarPozoCompleto(data).some((mensaje) => mensaje.includes("ranura es obligatoria")));
});

test("el PDF formatea ranuras y fallback histórico", () => {
  assert.equal(formatearRanuraFiltro(0.5), "0.50 mm");
  assert.equal(formatearRanuraFiltro(0.75), "0.75 mm");
  assert.equal(formatearRanuraFiltro(1), "1 mm");
  assert.equal(formatearRanuraFiltro(null), "No especificada");
});
