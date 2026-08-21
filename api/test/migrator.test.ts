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
  ejecutarMigraciones,
  leerMigraciones,
  normalizarSaltosLineaSQL,
  validarLedger,
  type Migracion,
  type MigracionAplicada,
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

function migracionesLedgerFixture(): Migracion[] {
  return ["000", "001", "002", "003", "004", "005", "006"].map((version) => {
    const sql = `SELECT '${version}';\n`;
    return {
      version,
      nombre: `migration_${version}`,
      archivo: `${version}_migration_${version}.sql`,
      checksum: checksumMigracion(sql),
      checksumsLegacy: checksumsLegacyMigracion(sql),
      sql,
    };
  });
}

function aplicada(migracion: Migracion, checksum = migracion.checksum): MigracionAplicada {
  return { version: migracion.version, nombre: migracion.nombre, checksum_sha256: checksum };
}

test("ledger aplicado debe ser exactamente un prefijo contiguo de las migraciones locales", () => {
  const migraciones = migracionesLedgerFixture();
  for (const cantidad of [0, 1, 3, migraciones.length]) {
    assert.doesNotThrow(() => validarLedger(migraciones.slice(0, cantidad).map((x) => aplicada(x)), migraciones));
  }

  for (const versiones of [["000", "002"], ["000", "001", "003"], ["006"], ["001"], ["001", "000"]]) {
    const ledger = versiones.map((version) => aplicada(migraciones.find((x) => x.version === version)!));
    assert.throws(() => validarLedger(ledger, migraciones), /no es un prefijo contiguo/, versiones.join(","));
  }
});

test("prefijo conserva checksums canonico y CRLF legacy pero rechaza contenido distinto", () => {
  const migraciones = migracionesLedgerFixture();
  const primera = migraciones[0];
  const legacy = primera.checksumsLegacy[0];
  assert.ok(legacy);
  assert.doesNotThrow(() => validarLedger([aplicada(primera, legacy)], migraciones));
  assert.throws(
    () => validarLedger([aplicada(primera, checksumSha256("SELECT 'alterada';\n"))], migraciones),
    /Checksum diferente/,
  );
});

test("ledger mantiene rechazo de formato duplicados versiones desconocidas y nombres alterados", () => {
  const migraciones = migracionesLedgerFixture();
  const primera = aplicada(migraciones[0]);
  assert.throws(() => validarLedger([{ ...primera, version: "0" }], migraciones), /Formato de versi.n inv.lido/);
  assert.throws(() => validarLedger([primera, primera], migraciones), /entrada duplicada/);
  assert.throws(
    () => validarLedger([{ ...primera, version: "999" }], migraciones),
    /migraci.n desconocida/,
  );
  assert.throws(
    () => validarLedger([{ ...primera, nombre: "nombre_alterado" }], migraciones),
    /nombre de la migraci.n 000 no coincide/,
  );
});

test("ledger con hueco falla bajo advisory lock antes de transaccion incluso con adoption", async () => {
  const directorio = await fs.mkdtemp(path.join(os.tmpdir(), "rsp07f-r13-ledger-"));
  try {
    await Promise.all([
      fs.writeFile(path.join(directorio, "000_cero.sql"), "SELECT 0;\n"),
      fs.writeFile(path.join(directorio, "001_uno.sql"), "SELECT 1;\n"),
      fs.writeFile(path.join(directorio, "002_dos.sql"), "SELECT 2;\n"),
    ]);
    const migraciones = await leerMigraciones(directorio);
    const consultas: string[] = [];
    let liberado = false;
    const client = {
      async query(sql: string) {
        const normalizado = sql.trim();
        consultas.push(normalizado);
        if (normalizado.includes("pg_try_advisory_lock")) return { rows: [{ obtenido: true }] };
        if (normalizado.includes("to_regclass('public.schema_migrations')")) return { rows: [{ existe: true }] };
        if (normalizado.includes("FROM public.schema_migrations")) return {
          rows: [aplicada(migraciones[0]), aplicada(migraciones[2])],
        };
        return { rows: [] };
      },
      release() { liberado = true; },
    };

    await assert.rejects(
      () => ejecutarMigraciones({ async connect() { return client; } } as never, {
        directorio,
        adoptarEsquemaActual: true,
        logger: () => undefined,
      }),
      /no es un prefijo contiguo/,
    );
    assert.equal(consultas.some((sql) => sql === "BEGIN"), false);
    assert.equal(consultas.some((sql) => sql.startsWith("INSERT INTO public.schema_migrations")), false);
    assert.equal(consultas.includes("SELECT 0;"), false);
    assert.equal(consultas.includes("SELECT 1;"), false);
    assert.equal(consultas.includes("SELECT 2;"), false);
    assert.ok(consultas.some((sql) => sql.includes("pg_advisory_unlock")));
    assert.equal(liberado, true);
  } finally {
    await fs.rm(directorio, { recursive: true, force: true });
  }
});
