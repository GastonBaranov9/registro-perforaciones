import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checksumMigracion,
  checksumMigracionAplicadaValido,
  checksumSha256,
  checksumsLegacyMigracion,
  leerMigraciones,
  normalizarSaltosLineaSQL,
} from "../src/db/migrator.ts";

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

test("canonicaliza exclusivamente saltos de linea para el checksum", () => {
  const lf = "-- comentario\nSELECT 'valor con espacio ';\n";
  const crlf = lf.replace(/\n/g, "\r\n");
  assert.equal(normalizarSaltosLineaSQL(crlf), lf);
  assert.equal(checksumMigracion(lf), checksumMigracion(crlf));
  assert.notEqual(checksumMigracion(lf), checksumMigracion(lf.replace("SELECT", "SELECT  ")));
  assert.notEqual(checksumMigracion(lf), checksumMigracion(lf.replace("comentario", "comentario editado")));
  assert.notEqual(checksumMigracion(lf), checksumMigracion(lf.replace("valor", "otro")));
  assert.deepEqual(checksumsLegacyMigracion(lf), [checksumSha256(crlf)]);
});

test("leerMigraciones reconoce solo el checksum CRLF legacy del mismo SQL", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rsp07f-r10-migrations-"));
  try {
    const lf = "-- mismo SQL\nSELECT 1;\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    await fs.writeFile(path.join(dir, "001_uno.sql"), crlf);
    const [migracion] = await leerMigraciones(dir);
    assert.equal(migracion.sql, lf);
    assert.equal(migracion.checksum, checksumMigracion(lf));
    assert.deepEqual(migracion.checksumsLegacy, [checksumSha256(crlf)]);
    assert.equal(checksumMigracionAplicadaValido(migracion, migracion.checksum), true);
    assert.equal(checksumMigracionAplicadaValido(migracion, checksumSha256(crlf)), true);
    assert.equal(checksumMigracionAplicadaValido(migracion, checksumSha256("SELECT 2;\r\n")), false);
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
