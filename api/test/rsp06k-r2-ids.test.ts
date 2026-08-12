import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { actualizarPozoCompleto, resolverLitologiasOriginales } from "../src/services/pozo-completo-service.ts";

const original = [{ id_intervalo_litologico: 10, desde_m: 0, hasta_m: 10, material: "Arenisca", id_litologia: 5 }];
const error400 = (error: unknown) => error instanceof Error && (error as Error & { statusCode?: number }).statusCode === 400;

test("rechaza ID litológico explícito inexistente sin fallback legacy", () => {
  assert.throws(() => resolverLitologiasOriginales(
    [{ id_intervalo_litologico: 999, desde_m: 0, hasta_m: 10, material: "Arenisca" }], original,
  ), error400);
});

test("rechaza el consumo duplicado de un ID litológico explícito", () => {
  assert.throws(() => resolverLitologiasOriginales([
    { id_intervalo_litologico: 10, desde_m: 0, hasta_m: 10, material: "Arenisca" },
    { id_intervalo_litologico: 10, desde_m: 10, hasta_m: 20, material: "Roca" },
  ], original), error400);
});

test("valida el ID antes de UPDATE y DELETE", async () => {
  const consultas: string[] = [];
  const client = {
    async query(sql: string) {
      consultas.push(sql);
      if (sql.includes("JOIN usuario_rol")) return { rows: [{ id_usuario: 2 }] };
      if (sql.includes("SELECT id_pozo,id_sitio")) return { rows: [{ id_pozo: 55, id_sitio: 4 }] };
      if (sql.includes("SELECT id_intervalo_litologico,desde_m")) return { rows: original };
      return { rows: [] };
    },
    release() {},
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06k-r2-id-"));
  try {
    await assert.rejects(() => actualizarPozoCompleto(55, {
      pozo: { id_propietario: 2, id_perforador: 8, id_sitio: 4, profundidad_final_m: 10 },
      intervalos_litologicos: [{ id_intervalo_litologico: 999, desde_m: 0, hasta_m: 10, material: "Arenisca" }],
      intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [], foto_accion: "conservar",
    }, dir, { async connect() { return client; } } as never), error400);
    assert.equal(consultas.some((sql) => sql.startsWith("UPDATE pozo SET")), false);
    assert.equal(consultas.some((sql) => sql.startsWith("DELETE FROM")), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
