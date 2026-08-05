import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crearPozoCompleto, validarPozoCompleto } from "../src/services/pozo-completo-service.ts";
import type { PozoCompletoBody } from "../src/models/schemas.ts";

function body(): PozoCompletoBody {
  return {
    pozo: { id_propietario: 10, id_sitio: 20, id_perforador: 30, profundidad_final_m: 50 },
    intervalos_litologicos: [{ desde_m: 0, hasta_m: 10, material: "Arena" }, { desde_m: 15, hasta_m: 30, material: "Roca" }],
    intervalos_diametro: [{ desde_m: 0, hasta_m: 25, diametro_pulg: 8, material_tuberia: "PVC" }, { desde_m: 25, hasta_m: 50, diametro_pulg: 6, material_tuberia: "Acero" }],
    intervalos_filtro: [],
    niveles_aporte: [{ profundidad_m: 18 }],
  };
}

function poolFalso(fallarEn?: string) {
  const consultas: string[] = [];
  let lit = 0;
  let diam = 0;
  let filtro = 0;
  const client = {
    async query(sql: string) {
      consultas.push(sql);
      if (fallarEn && sql.includes(fallarEn)) throw new Error("fallo controlado");
      if (sql.includes("JOIN usuario_rol")) return { rows: [{ id_usuario: 10 }] };
      if (sql.includes("INSERT INTO public.pozo")) return { rows: [{ id_pozo: "101", id_propietario: 10, id_sitio: 20, id_perforador: 30, profundidad_final_m: "50", fecha_creado: new Date().toISOString() }] };
      if (sql.includes("INSERT INTO intervalo_litologico")) return { rows: [{ id_intervalo_litologico: String(++lit), id_pozo: "101", desde_m: "0", hasta_m: "10", material: "Arena" }] };
      if (sql.includes("INSERT INTO intervalo_diametro")) return { rows: [{ id_intervalo_diametro_perforacion: String(++diam), id_pozo: "101", desde_m: "0", hasta_m: "25", diametro_pulg: "8" }] };
      if (sql.includes("INSERT INTO intervalo_filtro")) return { rows: [{ id_intervalo_filtro: String(++filtro), id_pozo: "101", desde_m: "20", hasta_m: "25", diametro_pulg: "6", material_tuberia: "PVC" }] };
      if (sql.includes("INSERT INTO nivel_aporte")) return { rows: [{ id_nivel_aporte: "1", id_pozo: "101", profundidad_m: "18" }] };
      return { rows: [] };
    },
    release() { consultas.push("RELEASE"); },
  };
  return { consultas, pool: { async connect() { return client; } } };
}

test("crea pozo y todos sus hijos en una sola transacción", async () => {
  const falso = poolFalso();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06b-"));
  try {
    const resultado = await crearPozoCompleto(30, body(), dir, falso.pool as never);
    assert.equal(resultado.pozo.id_pozo, 101);
    assert.equal(resultado.intervalos_litologicos.length, 2);
    assert.equal(resultado.intervalos_diametro.length, 2);
    assert.equal(resultado.niveles_aporte.length, 1);
    assert.ok(falso.consultas.includes("BEGIN"));
    assert.ok(falso.consultas.includes("COMMIT"));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("creación solo general también es atómica", async () => {
  const falso = poolFalso();
  const data = body();
  data.intervalos_litologicos = [];
  data.intervalos_diametro = [];
  data.niveles_aporte = [];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06b-"));
  try {
    const resultado = await crearPozoCompleto(30, data, dir, falso.pool as never);
    assert.equal(resultado.intervalos_litologicos.length, 0);
    assert.ok(falso.consultas.includes("COMMIT"));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("intervalo inválido o solapado se rechaza antes de abrir transacción", () => {
  const invalido = body();
  invalido.intervalos_litologicos[0].hasta_m = 0;
  assert.ok(validarPozoCompleto(invalido).some((mensaje) => mensaje.includes("hasta")));
  const solapado = body();
  solapado.intervalos_litologicos[1].desde_m = 9;
  assert.ok(validarPozoCompleto(solapado).some((mensaje) => mensaje.includes("solapan")));
});

test("filtros opcionales validan material profundidad y solapamiento por categoría", async () => {
  const valido = body();
  valido.intervalos_filtro = [{ desde_m: 10, hasta_m: 15, diametro_pulg: 6, material_tuberia: "PVC" }, { desde_m: 20, hasta_m: 25, diametro_pulg: 6, material_tuberia: "Acero" }];
  assert.deepEqual(validarPozoCompleto(valido), []);
  const solapado = structuredClone(valido); solapado.intervalos_filtro[1].desde_m = 14;
  assert.ok(validarPozoCompleto(solapado).some((x) => x.includes("solapan")));
  const excedido = structuredClone(valido); excedido.intervalos_filtro[1].hasta_m = 51;
  assert.ok(validarPozoCompleto(excedido).some((x) => x.includes("excede")));
  const invalido = structuredClone(valido); invalido.intervalos_diametro[0].material_tuberia = "pvc" as "PVC";
  assert.ok(validarPozoCompleto(invalido).some((x) => x.includes("material inválido")));
  const falso = poolFalso(); const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06e-"));
  try { const resultado = await crearPozoCompleto(30, valido, dir, falso.pool as never); assert.equal(resultado.intervalos_filtro.length, 2); assert.ok(falso.consultas.includes("COMMIT")); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("un fallo de hijo revierte el padre y no deja fotografía", async () => {
  const falso = poolFalso("INSERT INTO intervalo_diametro");
  const data = body();
  data.foto = { mime_type: "image/png", base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString("base64") };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06b-"));
  try {
    await assert.rejects(() => crearPozoCompleto(30, data, dir, falso.pool as never));
    assert.ok(falso.consultas.includes("ROLLBACK"));
    assert.deepEqual(await fs.readdir(dir), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("fotografía válida se nombra solo desde id_pozo y se relaciona antes del commit", async () => {
  const falso = poolFalso();
  const data = body();
  data.foto = { mime_type: "image/jpeg", base64: Buffer.from([0xff, 0xd8, 0xff, 1]).toString("base64") };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06b-"));
  try {
    await crearPozoCompleto(30, data, dir, falso.pool as never);
    assert.deepEqual(await fs.readdir(dir), ["pozo-101.jpg"]);
    const update = falso.consultas.findIndex((sql) => sql.includes("UPDATE pozo SET foto_url"));
    const commit = falso.consultas.indexOf("COMMIT");
    assert.ok(update >= 0 && update < commit);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
