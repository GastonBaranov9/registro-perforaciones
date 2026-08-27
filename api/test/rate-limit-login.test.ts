import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimitPlugin from "../src/plugins/rate-limit.ts";
import loginRoutes from "../src/routes/login.ts";
import { cargarConfiguracionRuntime } from "../src/config/runtime.ts";

async function conLimites<T>(api: number, login: number, ejecutar: () => Promise<T>): Promise<T> {
  const anteriorApi = process.env.RATE_LIMIT_API_MAX;
  const anteriorLogin = process.env.RATE_LIMIT_LOGIN_MAX;
  process.env.RATE_LIMIT_API_MAX = String(api);
  process.env.RATE_LIMIT_LOGIN_MAX = String(login);
  try { return await ejecutar(); }
  finally {
    if (anteriorApi === undefined) delete process.env.RATE_LIMIT_API_MAX; else process.env.RATE_LIMIT_API_MAX = anteriorApi;
    if (anteriorLogin === undefined) delete process.env.RATE_LIMIT_LOGIN_MAX; else process.env.RATE_LIMIT_LOGIN_MAX = anteriorLogin;
  }
}

async function appLoginReal(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("authenticate", async (_req: unknown, rep: { code(codigo: number): { send(valor: unknown): unknown } }) =>
    rep.code(401).send({ statusCode: 401, error: "Unauthorized", message: "Sesión inválida o no autorizada" }));
  app.decorate("authenticateWeb", async (_req: unknown, rep: { code(codigo: number): { send(valor: unknown): unknown } }) =>
    rep.code(401).send({ statusCode: 401, error: "Unauthorized", message: "Sesión inválida o no autorizada" }));
  app.decorate("jwt", { sign: () => "fixture" });
  await app.register(rateLimitPlugin);
  await app.register(loginRoutes);
  await app.ready();
  return app;
}

async function appLoginControlado(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(rateLimitPlugin);
  app.post("/login", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["email", "password"],
        properties: { email: { type: "string" }, password: { type: "string", minLength: 8 } },
      },
    },
    onRequest: [app.rateLimitLogin],
  }, async (req, rep) => {
    const body = req.body as { email: string; password: string };
    if (body.email !== "cuenta@example.test" || body.password !== "Password123!")
      return rep.code(401).send({ statusCode: 401, error: "Unauthorized", message: "Credenciales incorrectas" });
    return { authenticated: true };
  });
  await app.ready();
  return app;
}

test("la politica de login conserva 10 intentos por minuto por defecto", () => {
  assert.equal(cargarConfiguracionRuntime({}).rateLimits.login, 10);
});

test("POST /login cuenta antes de parsing y schema validation", async () => {
  await conLimites(100, 5, async () => {
    const app = await appLoginReal();
    try {
      const schema = await app.inject({ method: "POST", url: "/login", payload: { email: "incompleto@example.test" } });
      assert.equal(schema.statusCode, 400);

      const vacio = await app.inject({ method: "POST", url: "/login", headers: { "content-type": "application/json" }, payload: "" });
      assert.equal(vacio.statusCode, 400);

      const malformado1 = await app.inject({ method: "POST", url: "/login", headers: { "content-type": "application/json" }, payload: '{"email":' });
      assert.equal(malformado1.statusCode, 400);
      const malformado2 = await app.inject({ method: "POST", url: "/login", headers: { "content-type": "application/json" }, payload: "{" });
      assert.equal(malformado2.statusCode, 400);

      const quinto = await app.inject({ method: "POST", url: "/login", payload: {} });
      assert.equal(quinto.statusCode, 400);
      const limitado = await app.inject({ method: "POST", url: "/login", payload: {} });
      assert.equal(limitado.statusCode, 429);
      assert.ok(Number(limitado.headers["retry-after"]) >= 1);
    } finally { await app.close(); }
  });
});

test("login valido y password incorrecta consumen el limitador especifico sin revelar la cuenta", async () => {
  await conLimites(100, 2, async () => {
    const app = await appLoginControlado();
    try {
      const valido = await app.inject({ method: "POST", url: "/login", payload: { email: "cuenta@example.test", password: "Password123!" } });
      assert.equal(valido.statusCode, 200);
      const incorrecta = await app.inject({ method: "POST", url: "/login", payload: { email: "cuenta@example.test", password: "incorrecta" } });
      assert.equal(incorrecta.statusCode, 401);
      assert.equal(incorrecta.json().message, "Credenciales incorrectas");
      const limitado = await app.inject({ method: "POST", url: "/login", payload: { email: "nadie@example.test", password: "incorrecta" } });
      assert.equal(limitado.statusCode, 429);
      assert.ok(Number(limitado.headers["retry-after"]) >= 1);
    } finally { await app.close(); }
  });
});

test("GET /login y otras rutas API permanecen bajo el limite global", async () => {
  await conLimites(10, 10, async () => {
    const login = await appLoginReal();
    try {
      for (let intento = 0; intento < 10; intento += 1)
        assert.equal((await login.inject({ method: "GET", url: "/login" })).statusCode, 401);
      const limitado = await login.inject({ method: "GET", url: "/login" });
      assert.equal(limitado.statusCode, 429);
      assert.ok(Number(limitado.headers["retry-after"]) >= 1);
    } finally { await login.close(); }

    const otra = Fastify({ logger: false });
    await otra.register(rateLimitPlugin);
    otra.get("/otra", async () => ({ ok: true }));
    await otra.ready();
    try {
      for (let intento = 0; intento < 10; intento += 1) assert.equal((await otra.inject("/otra")).statusCode, 200);
      assert.equal((await otra.inject("/otra")).statusCode, 429);
    } finally { await otra.close(); }
  });
});
