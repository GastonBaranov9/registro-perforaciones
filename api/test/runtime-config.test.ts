import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cargarConfiguracionRuntime } from "../src/config/runtime.ts";

function entornoProduccion(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    API_PORT: "3000",
    FOTOS_DIR: path.resolve(os.tmpdir(), "rsp07b-fotos-config"),
    FASTIFY_SECRET: randomBytes(32).toString("hex"),
    PGUSER: "usuario_prueba",
    PGPASSWORD: randomBytes(24).toString("hex"),
    PGHOST: "postgres",
    PGPORT: "5432",
    PGDATABASE: "registro_prueba",
    MAP_STATIC_URL_TEMPLATE: "https://maps.googleapis.com/maps/api/staticmap?center={latitud},{longitud}&key={apiKey}",
    MAP_STATIC_ALLOWED_HOST: "maps.googleapis.com",
    MAP_STATIC_API_KEY: randomBytes(16).toString("hex"),
    MAP_STATIC_ATTRIBUTION: "Google Maps",
    PUBLIC_HOST: "perforaciones.example.test",
    PUBLIC_ORIGIN: "https://perforaciones.example.test",
    CORS_ORIGINS: "https://integracion.example.test",
  };
}

test("acepta un contrato de producción completo y normaliza origins", () => {
  const config = cargarConfiguracionRuntime(entornoProduccion());
  assert.equal(config.production, true);
  assert.equal(config.apiPort, 3000);
  assert.equal(config.postgres.host, "postgres");
  assert.equal(config.publicHost, "perforaciones.example.test");
  assert.equal(config.publicOrigin, "https://perforaciones.example.test");
  assert.equal(config.trustProxy, 1);
  assert.deepEqual(config.corsOrigins, ["https://perforaciones.example.test", "https://integracion.example.test"]);
});

test("falla temprano ante variables críticas ausentes sin imprimir secretos", () => {
  const env = entornoProduccion();
  delete env.PGPASSWORD;
  assert.throws(() => cargarConfiguracionRuntime(env), /Falta configurar PGPASSWORD/);

  const secreto = "corto-no-mostrar";
  const envSecreto = { ...entornoProduccion(), FASTIFY_SECRET: secreto };
  try {
    cargarConfiguracionRuntime(envSecreto);
    assert.fail("debió rechazar el secreto");
  } catch (error) {
    const mensaje = String(error);
    assert.match(mensaje, /FASTIFY_SECRET/);
    assert.doesNotMatch(mensaje, new RegExp(secreto));
  }
});

test("rechaza puertos, rutas y configuración Maps imposibles", () => {
  assert.throws(() => cargarConfiguracionRuntime({ ...entornoProduccion(), API_PORT: "70000" }), /API_PORT/);
  assert.throws(() => cargarConfiguracionRuntime({ ...entornoProduccion(), FOTOS_DIR: "relativa/fotos" }), /FOTOS_DIR/);
  assert.throws(
    () => cargarConfiguracionRuntime({ ...entornoProduccion(), MAP_STATIC_URL_TEMPLATE: "http://maps.googleapis.com/x?lat={latitud}&lon={longitud}&key={apiKey}" }),
    /HTTPS/,
  );
  assert.throws(
    () => cargarConfiguracionRuntime({ ...entornoProduccion(), MAP_STATIC_ALLOWED_HOST: "example.test" }),
    /no coincide/,
  );
});

test("producción exige dominio concreto y origin HTTPS coherente", () => {
  assert.throws(() => cargarConfiguracionRuntime({ ...entornoProduccion(), PUBLIC_HOST: "*" }), /PUBLIC_HOST/);
  assert.throws(() => cargarConfiguracionRuntime({ ...entornoProduccion(), PUBLIC_HOST: "Perforaciones.example.test" }), /PUBLIC_HOST/);
  assert.throws(() => cargarConfiguracionRuntime({ ...entornoProduccion(), PUBLIC_HOST: "localhost", PUBLIC_ORIGIN: "https://localhost" }), /PUBLIC_HOST/);
  assert.throws(() => cargarConfiguracionRuntime({ ...entornoProduccion(), PUBLIC_ORIGIN: "http://perforaciones.example.test" }), /PUBLIC_ORIGIN/);
  assert.throws(() => cargarConfiguracionRuntime({ ...entornoProduccion(), PUBLIC_ORIGIN: "https://otro.example.test" }), /PUBLIC_ORIGIN/);
  assert.throws(() => cargarConfiguracionRuntime({ ...entornoProduccion(), CORS_ORIGINS: "http://localhost:4200" }), /CORS_ORIGINS/);
});

test("development conserva defaults locales sin exigir variables production", () => {
  const config = cargarConfiguracionRuntime({ NODE_ENV: "development" });
  assert.equal(config.apiPort, 3000);
  assert.equal(config.postgres.port, 5432);
  assert.equal(config.trustProxy, false);
  assert.equal(config.corsOrigins[0], "http://localhost:4200");
  assert.ok(path.isAbsolute(config.fotosDir));
});
