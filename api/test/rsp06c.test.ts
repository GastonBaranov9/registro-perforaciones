import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listarCandidatosPozo, validarPersonaPozo } from "../src/services/candidatos-pozo-service.ts";
import { actualizarPozoCompleto } from "../src/services/pozo-completo-service.ts";
import type { PozoCompletoUpdateBody } from "../src/models/schemas.ts";

test("catálogos separan activos por rol y fijan perforador no administrador", async () => {
  const sqlEjecutado: string[] = [];
  const db = { async query(sql: string, params: unknown[]) {
    sqlEjecutado.push(sql);
    const rol = String(params[0]); const id = params[1] == null ? null : Number(params[1]);
    const base = rol === "propietario"
      ? [{ id_usuario: 2, nombre: "Nombre repetido", email: "a@example.test", roles: [rol] }, { id_usuario: 3, nombre: "Nombre repetido", email: "b@example.test", roles: [rol] }]
      : [{ id_usuario: id ?? 8, nombre: "Perforador", email: "p@example.test", roles: [rol] }];
    return { rows: base };
  } };
  const resultado = await listarCandidatosPozo(8, false, db as never);
  assert.deepEqual(resultado.propietarios.map((x) => x.id_usuario), [2, 3]);
  assert.deepEqual(resultado.perforadores.map((x) => x.id_usuario), [8]);
  assert.ok(sqlEjecutado.every((sql) => sql.includes("u.activo = true") && !sql.includes("password") && !sql.includes("version_sesion")));
});

test("persona inexistente, inactiva o con rol incorrecto es rechazada", async () => {
  const db = { async query() { return { rows: [] }; } };
  await assert.rejects(() => validarPersonaPozo(999, "propietario", db as never), /no está activa|rol propietario/);
});

function updateBody(): PozoCompletoUpdateBody {
  return { pozo: { id_propietario: 2, id_perforador: 8, id_sitio: 4, profundidad_final_m: 40 },
    intervalos_litologicos: [{ desde_m: 0, hasta_m: 15, material: "Arena" }],
    intervalos_diametro: [{ desde_m: 0, hasta_m: 40, diametro_pulg: 6, material_tuberia: "PVC" }], intervalos_filtro: [], niveles_aporte: [{ profundidad_m: 20 }], foto_accion: "conservar" };
}

function poolActualizacion(fallar = false) {
  const consultas: string[] = [];
  const client = { async query(sql: string) {
    consultas.push(sql);
    if (sql.includes("JOIN usuario_rol")) return { rows: [{ id_usuario: 2 }] };
    if (sql.includes("SELECT id_pozo FROM pozo")) return { rows: [{ id_pozo: 55 }] };
    if (sql.includes("UPDATE pozo SET id_propietario")) return { rows: [{ id_pozo: 55, id_propietario: 2, id_perforador: 8, id_sitio: 4, profundidad_final_m: "40", foto_url: "/foto" }] };
    if (fallar && sql.includes("INSERT INTO intervalo_diametro")) throw new Error("fallo intermedio");
    if (sql.includes("INSERT INTO intervalo_litologico")) return { rows: [{ id_intervalo_litologico: 7, id_pozo: 55, desde_m: "0", hasta_m: "15", material: "Arena" }] };
    if (sql.includes("INSERT INTO intervalo_diametro")) return { rows: [{ id_intervalo_diametro_perforacion: 8, id_pozo: 55, desde_m: "0", hasta_m: "40", diametro_pulg: "6" }] };
    if (sql.includes("INSERT INTO nivel_aporte")) return { rows: [{ id_nivel_aporte: 9, id_pozo: 55, profundidad_m: "20" }] };
    return { rows: [] };
  }, release() { consultas.push("RELEASE"); } };
  return { consultas, pool: { async connect() { return client; } } };
}

test("actualización completa reemplaza hijos dentro de una transacción", async () => {
  const falso = poolActualizacion(); const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06c-"));
  try {
    const resultado = await actualizarPozoCompleto(55, updateBody(), dir, falso.pool as never);
    assert.equal(resultado.intervalos_litologicos[0].id_pozo, 55);
    assert.ok(falso.consultas.some((x) => x === "COMMIT"));
    assert.equal(falso.consultas.filter((x) => x.startsWith("DELETE FROM")).length, 4);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("fallo intermedio revierte datos generales e hijos", async () => {
  const falso = poolActualizacion(true); const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06c-"));
  try {
    await assert.rejects(() => actualizarPozoCompleto(55, updateBody(), dir, falso.pool as never));
    assert.ok(falso.consultas.includes("ROLLBACK")); assert.ok(!falso.consultas.includes("COMMIT"));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("profundidad reducida y solapamiento se rechazan antes de borrar hijos", async () => {
  const data = updateBody(); data.pozo.profundidad_final_m = 10;
  const falso = poolActualizacion(); const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06c-"));
  try { await assert.rejects(() => actualizarPozoCompleto(55, data, dir, falso.pool as never), /excede/); assert.equal(falso.consultas.length, 0); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("actualización conserva, elimina y reemplaza fotografía sin aceptar nombres del cliente", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06c-foto-"));
  try {
    await fs.writeFile(path.join(dir, "pozo-55.jpg"), Buffer.from([0xff, 0xd8, 1]));
    await actualizarPozoCompleto(55, { ...updateBody(), foto_accion: "conservar" }, dir, poolActualizacion().pool as never);
    assert.ok((await fs.readdir(dir)).includes("pozo-55.jpg"));
    await actualizarPozoCompleto(55, { ...updateBody(), foto_accion: "eliminar" }, dir, poolActualizacion().pool as never);
    assert.equal((await fs.readdir(dir)).some((x) => x.startsWith("pozo-55.")), false);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString("base64");
    await actualizarPozoCompleto(55, { ...updateBody(), foto_accion: "reemplazar", foto: { mime_type: "image/png", base64: png } }, dir, poolActualizacion().pool as never);
    assert.ok((await fs.readdir(dir)).includes("pozo-55.png"));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
