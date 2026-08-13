import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Writable } from "node:stream";
import Fastify from "fastify";
import { MemoryRateLimiter } from "../src/services/rate-limit-service.ts";
import { PdfCapacityError, PdfCapacityGate } from "../src/services/pdf-capacity.ts";
import { loggerOptions, sanitizarTextoLog } from "../src/logging.ts";
import { revocarSesionesUsuario } from "../src/services/auth-services.ts";
import rateLimitPlugin from "../src/plugins/rate-limit.ts";
import { pgConfig } from "../src/db/pool.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("rate limiter rechaza con Retry-After y se recupera al cambiar de ventana", () => {
  const limiter = new MemoryRateLimiter(2, 1_000);
  assert.equal(limiter.consume("ip", 1_000).allowed, true);
  assert.equal(limiter.consume("ip", 1_100).allowed, true);
  const rejected = limiter.consume("ip", 1_200);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterSeconds, 1);
  assert.equal(limiter.consume("ip", 2_001).allowed, true);
});

test("un mapa limitado devuelve 429 y no ejecuta otra llamada al proveedor", async () => {
  const app = Fastify({ logger: false });
  await app.register(rateLimitPlugin);
  let providerCalls = 0;
  app.get("/map", async (req, rep) => {
    await app.rateLimitMaps(req, rep);
    if (rep.sent) return;
    providerCalls += 1;
    return { ok: true };
  });
  for (let i = 0; i < 30; i += 1) assert.equal((await app.inject("/map")).statusCode, 200);
  const rejected = await app.inject("/map");
  assert.equal(rejected.statusCode, 429);
  assert.ok(Number(rejected.headers["retry-after"]) >= 1);
  assert.equal(providerCalls, 30);
  await app.close();
});

test("cola PDF limita concurrencia, rechaza saturaciÃ³n y libera slots", async () => {
  const gate = new PdfCapacityGate(1, 1, 5_000);
  const releaseFirst = await gate.acquire();
  const second = gate.acquire();
  await assert.rejects(gate.acquire(), PdfCapacityError);
  assert.deepEqual(gate.snapshot(), { active: 1, queued: 1 });
  releaseFirst();
  const releaseSecond = await second;
  assert.deepEqual(gate.snapshot(), { active: 1, queued: 0 });
  releaseSecond();
  assert.deepEqual(gate.snapshot(), { active: 0, queued: 0 });
  const releaseAfterFailure = await gate.acquire();
  try { throw new Error("fallo controlado"); } catch { releaseAfterFailure(); }
  assert.equal(gate.snapshot().active, 0);
});

test("sanitiza claves Maps y passwords embebidos en DATABASE_URL", () => {
  const key = "NO_ES_UN_SECRETO_REAL";
  const output = sanitizarTextoLog(`https://maps.example/x?key=${key}&x=1 postgresql://user:password@example/db`);
  assert.doesNotMatch(output, new RegExp(key));
  assert.doesNotMatch(output, /:password@/);
  assert.match(output, /\[REDACTED\]/);
});

test("pool PostgreSQL tiene topes y timeouts explÃ­citos para runtime API", () => {
  assert.equal(pgConfig.max, 10);
  assert.equal(pgConfig.connectionTimeoutMillis, 5_000);
  assert.equal(pgConfig.statement_timeout, 30_000);
  assert.equal(pgConfig.idle_in_transaction_session_timeout, 15_000);
  assert.equal(pgConfig.query_timeout, 35_000);
});

test("logger estructurado redacta headers, password y base64", async () => {
  let output = "";
  const stream = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
  const app = Fastify({ logger: { ...loggerOptions("info"), stream } as never });
  app.post("/log", async (req) => {
    req.log.info({ req, password: "PASSWORD_MARKER", foto: { base64: "BASE64_MARKER" } }, "evento");
    req.log.error({ err: new Error("https://maps.example/x?key=GOOGLE_KEY_MARKER") }, "provider");
    return { ok: true };
  });
  await app.inject({ method: "POST", url: "/log", headers: { cookie: "COOKIE_MARKER", authorization: "TOKEN_MARKER", "x-csrf-token": "CSRF_MARKER" }, payload: { password: "PASSWORD_MARKER" } });
  await app.close();
  for (const marker of ["PASSWORD_MARKER", "COOKIE_MARKER", "TOKEN_MARKER", "CSRF_MARKER", "BASE64_MARKER", "GOOGLE_KEY_MARKER"])
    assert.doesNotMatch(output, new RegExp(marker));
  assert.match(output, /\[REDACTED\]/);
});

test("logout incrementa version_sesion con SQL parametrizado", async () => {
  let sql = "";
  let params: unknown[] = [];
  const ok = await revocarSesionesUsuario(41, {
    async query(text: string, values?: unknown[]) {
      sql = text;
      params = values ?? [];
      return { rowCount: 1 } as never;
    },
  });
  assert.equal(ok, true);
  assert.match(sql, /version_sesion = version_sesion \+ 1/);
  assert.match(sql, /id_usuario = \$1/);
  assert.deepEqual(params, [41]);
});

test("proxy publica CSP/Permissions y HSTS se deriva de booleano validado", async () => {
  const proxy = await fs.readFile(path.join(repo, "proxy", "https.conf.template"), "utf8");
  const startup = await fs.readFile(path.join(repo, "proxy", "start.sh"), "utf8");
  const compose = await fs.readFile(path.join(repo, "docker-compose.production.yaml"), "utf8");
  assert.match(proxy, /Content-Security-Policy/);
  assert.match(proxy, /script-src 'self'/);
  assert.match(proxy, /style-src 'self' 'unsafe-inline'/);
  assert.match(proxy, /frame-ancestors 'none'/);
  assert.match(proxy, /Permissions-Policy "geolocation=\(self\), camera=\(\)/);
  assert.doesNotMatch(proxy, /maps\.googleapis\.com/);
  assert.match(startup, /true\) HSTS_HEADER="max-age=31536000"/);
  assert.match(startup, /false\) HSTS_HEADER=""/);
  assert.match(compose, /max-size: "10m"/);
  assert.match(proxy, /X-Request-Id \$request_id/);
  const angular = await fs.readFile(path.join(repo, "front", "angular.json"), "utf8");
  assert.match(angular, /"inlineCritical": false/);
});
