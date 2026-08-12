import assert from "node:assert/strict";
import test from "node:test";
import { normalizarCoordenadaTexto, normalizarCoordenadasTexto } from "../src/utils/coordenadas.ts";
import { validarPozoCompleto } from "../src/services/pozo-completo-service.ts";

function cerca(actual: string | null, esperado: number) {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(Number(actual) - esperado) < 1e-7, `${actual} no se aproxima a ${esperado}`);
}

test("normaliza el caso histórico DMS y variantes con espacios", () => {
  cerca(normalizarCoordenadaTexto(`31°26'38.1"S`, "latitud"), -31.4439167);
  cerca(normalizarCoordenadaTexto(`57°59'11.6"W`, "longitud"), -57.9865556);
  cerca(normalizarCoordenadaTexto(`34°54'31.3"S`, "latitud"), -(34 + 54 / 60 + 31.3 / 3600));
  assert.equal(normalizarCoordenadaTexto(`31° 26' 38.1" S`, "latitud"), "-31.4439167");
  assert.equal(normalizarCoordenadaTexto("57 59 11.6 W", "longitud"), "-57.9865556");
});

test("conserva decimales, cero y límites válidos", () => {
  assert.deepEqual(normalizarCoordenadasTexto("-31.4439167", "-57.9865556", true), {
    latitud: "-31.4439167", longitud: "-57.9865556",
  });
  for (const [valor, eje, esperado] of [
    ["0", "latitud", "0"], ["90°0'0\"N", "latitud", "90"], ["90°0'0\"S", "latitud", "-90"],
    ["180°0'0\"E", "longitud", "180"], ["180°0'0\"W", "longitud", "-180"],
  ] as const) assert.equal(normalizarCoordenadaTexto(valor, eje), esperado);
});

test("rechaza DMS inválido, ambiguo, incompatible o contradictorio", () => {
  const invalidas: Array<[string, "latitud" | "longitud"]> = [
    ["31°60'0\"S", "latitud"], ["31°20'60\"S", "latitud"], ["91°0'0\"N", "latitud"],
    ["181°0'0\"W", "longitud"], ["31°0'0\"E", "latitud"], ["57°0'0\"N", "longitud"],
    ["-31°26'38.1\"N", "latitud"], ["-31°26'38.1\"S", "latitud"], ["31°26' S", "latitud"],
    ["", "latitud"], ["   ", "latitud"], ["texto", "latitud"], ["NaN", "latitud"], ["Infinity", "longitud"],
  ];
  for (const [valor, eje] of invalidas) assert.equal(normalizarCoordenadaTexto(valor, eje), null, valor);
});

test("la creación completa acepta DMS y mantiene la validación central", () => {
  const data = {
    pozo: { id_propietario: 1, id_perforador: 2, profundidad_final_m: 10 },
    sitio_nuevo: { departamento: "Salto", latitud: `31°26'38.1"S`, longitud: `57°59'11.6"W` },
    intervalos_litologicos: [], intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
  } as never;
  assert.deepEqual(validarPozoCompleto(data), []);
});
