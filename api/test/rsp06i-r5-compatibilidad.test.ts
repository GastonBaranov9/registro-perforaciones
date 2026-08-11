import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { updatePozo } from "../src/services/pozos-services.ts";
import { actualizarPozoCompleto, resolverLitologiasOriginales } from "../src/services/pozo-completo-service.ts";

test("el PUT legado de pozo alinea placeholders y mantiene id_sitio inmutable", async () => {
  let sql = "";
  let parametros: unknown[] = [];
  const db = { async query(sentencia: string, valores: unknown[]) {
    sql = sentencia;
    parametros = valores;
    return { rows: [{ id_pozo: 7, id_sitio: 11, empresa: "Actualizada" }] };
  } };
  const resultado = await updatePozo(7, { id_sitio: 99, empresa: "Actualizada" }, db as never);
  assert.equal(resultado?.id_sitio, 11);
  assert.equal(parametros.length, 17);
  assert.equal(parametros[2], "Actualizada");
  assert.doesNotMatch(sql, /\$18/);
  assert.match(sql, /empresa\s+= COALESCE\(\$3::text/);
  assert.match(sql, /revestimiento\s+= COALESCE\(\$17::text/);
});

test("un payload legacy conserva la litología del original identificado de forma inequívoca", () => {
  const resultado = resolverLitologiasOriginales(
    [{ desde_m: 0, hasta_m: 10, material: "  Arenisca\t" }],
    [{ id_intervalo_litologico: 10, desde_m: 0, hasta_m: 10, material: "Arenisca", id_litologia: 5 }],
  );
  assert.equal(resultado.get(0), 5);
});

test("dos intervalos legacy no pueden consumir el mismo original", () => {
  assert.throws(() => resolverLitologiasOriginales(
    [
      { desde_m: 0, hasta_m: 10, material: "Arenisca" },
      { desde_m: 0, hasta_m: 10, material: "Arenisca" },
    ],
    [{ id_intervalo_litologico: 10, desde_m: 0, hasta_m: 10, material: "Arenisca", id_litologia: 5 }],
  ), (error: unknown) => error instanceof Error && (error as Error & { statusCode?: number }).statusCode === 400);
});

test("un legacy ambiguo se rechaza en vez de elegir una litología arbitraria", () => {
  assert.throws(() => resolverLitologiasOriginales(
    [{ desde_m: 0, hasta_m: 10, material: "Arenisca" }],
    [
      { id_intervalo_litologico: 10, desde_m: 0, hasta_m: 10, material: "Arenisca", id_litologia: 5 },
      { id_intervalo_litologico: 11, desde_m: 0, hasta_m: 10, material: "Arenisca", id_litologia: 6 },
    ],
  ), (error: unknown) => error instanceof Error && (error as Error & { statusCode?: number }).statusCode === 400);
});

test("un intervalo nuevo sin ID persistido sigue sin asociación histórica", () => {
  const resultado = resolverLitologiasOriginales(
    [{ desde_m: 10, hasta_m: 20, material: "Roca" }],
    [{ id_intervalo_litologico: 10, desde_m: 0, hasta_m: 10, material: "Arenisca", id_litologia: 5 }],
  );
  assert.equal(resultado.get(0), undefined);
});

function poolCompleto(originales: Array<Record<string, unknown>>) {
  const consultas: string[] = [];
  let insercion: unknown[] | undefined;
  const client = {
    async query(sql: string, params?: unknown[]) {
      consultas.push(sql);
      if (sql.includes("JOIN usuario_rol")) return { rows: [{ id_usuario: params?.[1] ?? 2 }] };
      if (sql.includes("SELECT id_pozo,id_sitio")) return { rows: [{ id_pozo: 55, id_sitio: 4 }] };
      if (sql.includes("SELECT id_intervalo_litologico,desde_m")) return { rows: originales };
      if (sql.startsWith("UPDATE pozo SET")) return { rows: [{ id_pozo: 55, id_sitio: 4, id_propietario: 2, id_perforador: 8, profundidad_final_m: "10" }] };
      if (sql.includes("INSERT INTO intervalo_litologico")) {
        insercion = params;
        return { rows: [{ id_intervalo_litologico: 77, id_pozo: 55, desde_m: "0", hasta_m: "10", material: "Arenisca", id_litologia: params?.[4] ?? null }] };
      }
      if (sql.includes("SELECT id_sitio,departamento")) return { rows: [{ id_sitio: 4, departamento: "Salto", localidad: "Salto", latitud: "-31", longitud: "-57" }] };
      if (sql.startsWith("INSERT INTO intervalo_diametro") || sql.startsWith("INSERT INTO intervalo_filtro") || sql.startsWith("INSERT INTO nivel_aporte")) return { rows: [] };
      return { rows: [] };
    },
    release() { consultas.push("RELEASE"); },
  };
  return { consultas, get insercion() { return insercion; }, pool: { async connect() { return client; } } };
}

test("el update completo transmite al INSERT la litología del original legacy", async () => {
  const falso = poolCompleto([{ id_intervalo_litologico: 10, desde_m: 0, hasta_m: 10, material: "Arenisca", id_litologia: 5 }]);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06i-r5-"));
  try {
    await actualizarPozoCompleto(55, {
      pozo: { id_propietario: 2, id_perforador: 8, id_sitio: 4, profundidad_final_m: 10 },
      intervalos_litologicos: [{ desde_m: 0, hasta_m: 10, material: " Arenisca " }],
      intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [], foto_accion: "conservar",
    }, dir, falso.pool as never);
    assert.equal(falso.insercion?.[4], 5);
    assert.equal(falso.insercion?.[5], 5);
    assert.ok(falso.consultas.includes("COMMIT"));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("un matching ambiguo falla antes de borrar intervalos", async () => {
  const falso = poolCompleto([
    { id_intervalo_litologico: 10, desde_m: 0, hasta_m: 10, material: "Arenisca", id_litologia: 5 },
    { id_intervalo_litologico: 11, desde_m: 0, hasta_m: 10, material: "Arenisca", id_litologia: 6 },
  ]);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06i-r5-ambiguous-"));
  try {
    await assert.rejects(() => actualizarPozoCompleto(55, {
      pozo: { id_propietario: 2, id_perforador: 8, id_sitio: 4, profundidad_final_m: 10 },
      intervalos_litologicos: [{ desde_m: 0, hasta_m: 10, material: "Arenisca" }],
      intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [], foto_accion: "conservar",
    }, dir, falso.pool as never), (error: unknown) => error instanceof Error && (error as Error & { statusCode?: number }).statusCode === 400);
    assert.equal(falso.consultas.filter((sql) => sql.startsWith("DELETE FROM")).length, 0);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
