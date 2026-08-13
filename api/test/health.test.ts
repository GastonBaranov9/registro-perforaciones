import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { comprobarReadiness, crearRutasHealth, type ReadinessDb } from "../src/routes/health.ts";

test("GET /health informa solo que el proceso está vivo", async () => {
  const app = Fastify();
  await app.register(crearRutasHealth({ query: async () => { throw new Error("no debe consultar DB"); } }));
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
  await app.close();
});

test("GET /ready devuelve 200 con SELECT 1 y 503 sin filtrar el error", async () => {
  let consulta: { text: string; query_timeout: number } | undefined;
  const disponible: ReadinessDb = { query: async (config) => { consulta = config; } };
  const appOk = Fastify();
  await appOk.register(crearRutasHealth(disponible));
  const ok = await appOk.inject({ method: "GET", url: "/ready" });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { status: "ok" });
  assert.deepEqual(consulta, { text: "SELECT 1", query_timeout: 2000 });
  await appOk.close();

  const appFail = Fastify();
  await appFail.register(crearRutasHealth({ query: async () => { throw new Error("cadena sensible"); } }));
  const fail = await appFail.inject({ method: "GET", url: "/ready" });
  assert.equal(fail.statusCode, 503);
  assert.deepEqual(fail.json(), { status: "unavailable" });
  assert.doesNotMatch(fail.body, /cadena sensible/);
  await appFail.close();
});

test("comprobarReadiness encapsula fallos", async () => {
  assert.equal(await comprobarReadiness({ query: async () => undefined }), true);
  assert.equal(await comprobarReadiness({ query: async () => { throw new Error("db"); } }), false);
});
