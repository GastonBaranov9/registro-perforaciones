import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eliminarFotoPersistida } from "../src/services/foto-pozo-service.ts";

test("elimina archivo derivado del pozo y limpia referencia", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06b-foto-"));
  const archivo = path.join(dir, "pozo-8.jpg");
  await fs.writeFile(archivo, "foto");
  const consultas: unknown[][] = [];
  const db = { async query(_sql: string, params: unknown[]) { consultas.push(params); return { rows: [{ id_pozo: 8 }] }; } };
  try {
    const resultado = await eliminarFotoPersistida(8, dir, db);
    assert.equal(resultado.archivoExistia, true);
    assert.equal(await fs.stat(archivo).then(() => true, () => false), false);
    assert.deepEqual(consultas, [[8]]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("archivo físico inexistente deja la base consistente", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06b-foto-"));
  const db = { async query() { return { rows: [{ id_pozo: 9 }] }; } };
  try {
    assert.deepEqual(await eliminarFotoPersistida(9, dir, db), { archivoExistia: false });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("si falla la base restaura el archivo aislado", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp06b-foto-"));
  const archivo = path.join(dir, "pozo-10.png");
  await fs.writeFile(archivo, "foto");
  const db = { async query() { throw new Error("base no disponible"); } };
  try {
    await assert.rejects(() => eliminarFotoPersistida(10, dir, db));
    assert.equal(await fs.readFile(archivo, "utf8"), "foto");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
