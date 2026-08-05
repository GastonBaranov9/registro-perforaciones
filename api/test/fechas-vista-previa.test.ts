import assert from "node:assert/strict";
import test from "node:test";
import { formatearFechaCalendario } from "../src/utils/fechas.ts";
import { validarDatosTecnicosPozo } from "../src/services/pozo-completo-service.ts";
import { crearPerfilLitologico } from "../src/pdf/perfil-litologico.ts";

test("formatea DATE sin aplicar zona horaria ni cambiar el día", () => {
  assert.equal(formatearFechaCalendario("2026-08-05"), "05/08/2026");
  assert.equal(formatearFechaCalendario(new Date("2026-08-05T00:00:00.000Z")), "05/08/2026");
  assert.equal(formatearFechaCalendario(null), "No especificada");
  assert.equal(formatearFechaCalendario("fecha inválida"), "No especificada");
});

test("un borrador válido genera el mismo modelo canónico sin persistencia", () => {
  const borrador = { profundidad_final_m: 20, intervalos_litologicos: [{ desde_m: 0, hasta_m: 20, material: "Arena" }], intervalos_diametro: [{ desde_m: 0, hasta_m: 20, diametro_pulg: 8, material_tuberia: "PVC" as const }], intervalos_filtro: [{ desde_m: 10, hasta_m: 15, diametro_pulg: 6, material_tuberia: "Acero" as const }], niveles_aporte: [{ profundidad_m: 12 }] };
  assert.deepEqual(validarDatosTecnicosPozo(borrador), []);
  const perfil = crearPerfilLitologico(borrador.intervalos_litologicos, borrador.profundidad_final_m, borrador.niveles_aporte, borrador.intervalos_diametro, borrador.intervalos_filtro);
  assert.equal(perfil?.tuberias[0].material_tuberia, "PVC"); assert.equal(perfil?.filtros[0].material_tuberia, "Acero"); assert.equal(perfil?.aportes[0].profundidad_m, 12);
});

test("rechaza borradores solapados o fuera de profundidad", () => {
  const errores = validarDatosTecnicosPozo({ profundidad_final_m: 10, intervalos_litologicos: [{ desde_m: 0, hasta_m: 7, material: "Arena" }, { desde_m: 6, hasta_m: 11, material: "Limo" }], intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [{ profundidad_m: 12 }] });
  assert.ok(errores.some((error) => error.includes("solapan"))); assert.ok(errores.some((error) => error.includes("excede")));
});
