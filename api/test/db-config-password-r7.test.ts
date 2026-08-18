import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cargarConfiguracionRuntime } from "../src/config/runtime.ts";
import { cargarConfigDbOperaciones } from "../src/db/operaciones-config.ts";

function entorno(password?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    API_PORT: "3000",
    FOTOS_DIR: path.resolve(os.tmpdir(), "rsp07f-r7-fotos"),
    FASTIFY_SECRET: "fixture-runtime-secret-with-enough-length-123456",
    PGUSER: "fixture_user",
    PGHOST: "postgres",
    PGPORT: "5432",
    PGDATABASE: "fixture_db",
    PUBLIC_HOST: "fixture.example.test",
    PUBLIC_ORIGIN: "https://fixture.example.test",
    MAP_STATIC_URL_TEMPLATE: "https://maps.googleapis.com/maps/api/staticmap?center={latitud},{longitud}&key={apiKey}",
    MAP_STATIC_ALLOWED_HOST: "maps.googleapis.com",
    MAP_STATIC_API_KEY: "fixture-map-key",
    MAP_STATIC_ATTRIBUTION: "Google Maps",
  };
  if (password !== undefined) env.PGPASSWORD = password;
  return env;
}

test("PGPASSWORD conserva exactamente whitespace, tabs y Unicode en runtime y operaciones", () => {
  const casos = [
    "secret",
    " secret",
    "secret ",
    " secret ",
    "\tsecret\t",
    "contraseña-密碼-🔒",
    "   ",
  ];
  for (const password of casos) {
    assert.equal(cargarConfigDbOperaciones(entorno(password)).password, password);
    assert.equal(cargarConfiguracionRuntime(entorno(password)).postgres.password, password);
  }
});

test("PGPASSWORD ausente o de longitud cero se rechaza sin normalizar otros campos", () => {
  assert.throws(() => cargarConfigDbOperaciones(entorno()), /Falta configurar PGPASSWORD/);
  assert.throws(() => cargarConfiguracionRuntime(entorno()), /Falta configurar PGPASSWORD/);
  assert.throws(() => cargarConfigDbOperaciones(entorno("")), /Falta configurar PGPASSWORD/);
  assert.throws(() => cargarConfiguracionRuntime(entorno("")), /Falta configurar PGPASSWORD/);

  const config = cargarConfigDbOperaciones({
    ...entorno(" password "),
    PGHOST: " postgres ",
    PGUSER: " user ",
    PGDATABASE: " database ",
  });
  assert.equal(config.host, "postgres");
  assert.equal(config.user, "user");
  assert.equal(config.database, "database");
  assert.equal(config.password, " password ");
});

test("migrador y pool runtime reciben el password sin una segunda transformacion", async () => {
  const migrator = await fs.readFile(new URL("../src/scripts/migrate.ts", import.meta.url), "utf8");
  const pool = await fs.readFile(new URL("../src/db/pool.ts", import.meta.url), "utf8");
  const compose = await fs.readFile(new URL("../../docker-compose.production.yaml", import.meta.url), "utf8");
  assert.match(migrator, /new Pool\(cargarConfigDbOperaciones\(\)\)/);
  assert.match(pool, /password:\s*runtime\.postgres\.password/);
  assert.match(compose, /PGPASSWORD:\s*\$\{PGPASSWORD:\?Falta PGPASSWORD\}/);
});
