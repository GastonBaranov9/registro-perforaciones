import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checksumSha256, leerMigraciones } from "../src/db/migrator.ts";

test("descubre migraciones en orden determinista y calcula SHA-256", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp07c-migrations-"));
  try {
    await fs.writeFile(path.join(dir, "002_dos.sql"), "SELECT 2;\n");
    await fs.writeFile(path.join(dir, "001_uno.sql"), "SELECT 1;\n");
    await fs.writeFile(path.join(dir, "README.md"), "ignorado");
    const migraciones = await leerMigraciones(dir);
    assert.deepEqual(migraciones.map((x) => x.archivo), ["001_uno.sql", "002_dos.sql"]);
    assert.equal(migraciones[0].checksum, checksumSha256("SELECT 1;\n"));
    assert.match(migraciones[0].checksum, /^[0-9a-f]{64}$/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("rechaza versiones duplicadas y control transaccional dentro del SQL", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp07c-migrations-"));
  try {
    await fs.writeFile(path.join(dir, "001_uno.sql"), "SELECT 1;");
    await fs.writeFile(path.join(dir, "001_duplicada.sql"), "SELECT 2;");
    await assert.rejects(leerMigraciones(dir), /duplicada/);
    await fs.rm(path.join(dir, "001_duplicada.sql"));
    await fs.writeFile(path.join(dir, "002_invalida.sql"), "BEGIN;\nSELECT 2;\nCOMMIT;");
    await assert.rejects(leerMigraciones(dir), /propia transacción/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("el inicializador destructivo histórico queda retirado", async () => {
  const scripts = await fs.readFile(new URL("../db/scripts.sql", import.meta.url), "utf8");
  assert.match(scripts, /fue retirado por RSP-07C/);
  assert.match(scripts, /\\quit 3/);
  assert.doesNotMatch(scripts, /DROP TABLE/i);
});
