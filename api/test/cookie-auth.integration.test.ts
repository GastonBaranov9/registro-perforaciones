import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import cookies, {
  cookieOptions,
  CSRF_COOKIE,
  SESSION_COOKIE,
} from "../src/plugins/cookies.ts";
import csrf from "../src/plugins/csrf.ts";

test("jwtVerify con onlyCookie rechaza Bearer y acepta la cookie de sesiÃ³n", async () => {
  const app = Fastify();
  await app.register(cookies);
  await app.register(fastifyJwt, {
    secret: "secreto-de-prueba-suficientemente-largo",
    cookie: { cookieName: SESSION_COOKIE, signed: false },
  });
  app.get("/protegido", async (req, rep) => {
    try {
      await req.jwtVerify({ onlyCookie: true });
      return { ok: true };
    } catch {
      return rep.code(401).send({ ok: false });
    }
  });

  const token = app.jwt.sign({ sub: 1, version_sesion: 1 });
  const bearer = await app.inject({
    method: "GET",
    url: "/protegido",
    headers: { authorization: `Bearer ${token}` },
  });
  const cookie = await app.inject({
    method: "GET",
    url: "/protegido",
    cookies: { [SESSION_COOKIE]: token },
  });

  assert.equal(bearer.statusCode, 401);
  assert.equal(cookie.statusCode, 200);
  await app.close();
});

test("el hook CSRF protege mutaciones y deja libre el login", async () => {
  const app = Fastify();
  await app.register(cookies);
  await app.register(csrf);
  app.post("/login", async () => ({ ok: true }));
  app.post("/recurso", async () => ({ ok: true }));

  const sinCsrf = await app.inject({
    method: "POST",
    url: "/recurso",
    cookies: { [SESSION_COOKIE]: "jwt" },
  });
  const conCsrf = await app.inject({
    method: "POST",
    url: "/recurso",
    cookies: { [SESSION_COOKIE]: "jwt", [CSRF_COOKIE]: "csrf" },
    headers: { "x-csrf-token": "csrf" },
  });
  const login = await app.inject({ method: "POST", url: "/login" });

  assert.equal(sinCsrf.statusCode, 403);
  assert.equal(conCsrf.statusCode, 200);
  assert.equal(login.statusCode, 200);
  await app.close();
});

test("las cabeceras Set-Cookie separan sesiÃ³n HttpOnly y token CSRF", async () => {
  const app = Fastify();
  await app.register(cookies);
  app.get("/cookies", async (_req, rep) => {
    rep.setCookie(SESSION_COOKIE, "jwt", cookieOptions(true));
    rep.setCookie(CSRF_COOKIE, "csrf", cookieOptions(false));
    return { ok: true };
  });

  const response = await app.inject({ method: "GET", url: "/cookies" });
  const headers = response.headers["set-cookie"];
  assert.ok(Array.isArray(headers));
  assert.match(headers[0], /HttpOnly/i);
  assert.doesNotMatch(headers[1], /HttpOnly/i);
  assert.match(headers[0], /SameSite=Lax/i);
  await app.close();
});
