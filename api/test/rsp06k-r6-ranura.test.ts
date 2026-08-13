import assert from "node:assert/strict";
import test from "node:test";
import { resolverRanurasFiltros } from "../src/services/pozo-completo-service.ts";

const original = [
  { id_intervalo_filtro: 1, ranura_mm: 0.5 as const },
  { id_intervalo_filtro: 2, ranura_mm: 0.75 as const },
  { id_intervalo_filtro: 3, ranura_mm: 1 as const },
  { id_intervalo_filtro: 4, ranura_mm: null },
];
function filtro(id: number, ...ranura: [0.5 | 0.75 | 1 | null] | []) {
  return { id_intervalo_filtro: id, desde_m: id, hasta_m: id + 1, diametro_pulg: 6, material_tuberia: "PVC" as const, ...(ranura.length ? { ranura_mm: ranura[0] } : {}) };
}

test("ranura omitida conserva cada valor original, incluido NULL histórico", () => {
  const resultado = resolverRanurasFiltros([filtro(1), filtro(2), filtro(3), filtro(4)], original);
  assert.deepEqual([...resultado.values()], [0.5, 0.75, 1, null]);
});

test("ranura explícita actualiza NULL o un valor previo, pero null no borra una ranura moderna", () => {
  assert.equal(resolverRanurasFiltros([filtro(4, 0.75)], original).get(4), 0.75);
  assert.equal(resolverRanurasFiltros([filtro(2, 0.5)], original).get(2), 0.5);
  assert.throws(() => resolverRanurasFiltros([filtro(2, null)], original), /eliminar una ranura/);
  assert.equal(resolverRanurasFiltros([filtro(4, null)], original).get(4), null);
});
