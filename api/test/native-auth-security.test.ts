import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import cookies, { CSRF_COOKIE, SESSION_COOKIE } from "../src/plugins/cookies.ts";
import cors from "../src/plugins/cors.ts";
import csrf from "../src/plugins/csrf.ts";
import { leerMetadataNative } from "../src/plugins/jwt.ts";
import { sanitizarTextoLog } from "../src/logging.ts";
import {
  extraerBearerNativo,
  generarTokenNativo,
  hmacTokenNativo,
  tokenNativoBienFormado,
} from "../src/services/native-token-service.ts";

test("tokens native y WS contienen 256 bits, formato canónico y dominios HMAC separados", () => {
  const secret = "fixture-native-hmac-secret-with-at-least-32-characters";
  const session = generarTokenNativo("session");
  const ticket = generarTokenNativo("ws-ticket");
  assert.match(session, /^rspn1_[A-Za-z0-9_-]{43}$/);
  assert.match(ticket, /^rspw1_[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(session.slice(6), "base64url").length, 32);
  assert.equal(Buffer.from(ticket.slice(6), "base64url").length, 32);
  assert.equal(tokenNativoBienFormado(session), true);
  assert.equal(tokenNativoBienFormado(ticket, "ws-ticket"), true);
  assert.equal(tokenNativoBienFormado(`${session}x`), false);
  assert.equal(extraerBearerNativo(`Bearer ${session}`), session);
  assert.equal(extraerBearerNativo(`Basic ${session}`), null);
  assert.equal(extraerBearerNativo("Bearer "), null);

  const sessionHash = hmacTokenNativo(session, secret, "session");
  const ticketDomainHash = hmacTokenNativo(session, secret, "ws-ticket");
  assert.equal(sessionHash.length, 32);
  assert.equal(ticketDomainHash.length, 32);
  assert.notDeepEqual(sessionHash, ticketDomainHash);
  assert.equal(sessionHash.includes(Buffer.from(session)), false);
});

test("metadata native exige plataforma y build entero actual sin usar app_version", () => {
  assert.deepEqual(leerMetadataNative({
    "x-native-platform": "android",
    "x-native-app-build": "123",
    "x-native-app-version": "1.2.3-beta",
  }), { platform: "android", appBuild: 123, appVersion: "1.2.3-beta" });
  assert.deepEqual(leerMetadataNative({
    "x-native-platform": "ios",
    "x-native-app-build": "7",
  }), { platform: "ios", appBuild: 7 });
  for (const headers of [
    {},
    { "x-native-platform": "windows", "x-native-app-build": "1" },
    { "x-native-platform": "android", "x-native-app-build": "0" },
    { "x-native-platform": "android", "x-native-app-build": "01" },
    { "x-native-platform": "android", "x-native-app-build": "1.2" },
  ]) assert.equal(leerMetadataNative(headers), null);
});

test("CSRF conserva cookie double-submit y rechaza mezcla cookie/Bearer", async () => {
  const app = Fastify();
  await app.register(cookies);
  await app.register(csrf);
  app.post("/mutation", async () => ({ ok: true }));
  const token = generarTokenNativo("session");

  assert.equal((await app.inject({
    method: "POST", url: "/mutation", cookies: { [SESSION_COOKIE]: "jwt" },
  })).statusCode, 403);
  assert.equal((await app.inject({
    method: "POST", url: "/mutation",
    cookies: { [SESSION_COOKIE]: "jwt", [CSRF_COOKIE]: "control" },
    headers: { "x-csrf-token": "control" },
  })).statusCode, 200);
  assert.equal((await app.inject({
    method: "POST", url: "/mutation", headers: { authorization: `Bearer ${token}` },
  })).statusCode, 200);
  assert.equal((await app.inject({
    method: "POST", url: "/mutation",
    headers: { authorization: `Bearer ${token}`, "x-csrf-token": "control" },
    cookies: { [SESSION_COOKIE]: "jwt", [CSRF_COOKIE]: "control" },
  })).statusCode, 401);
  await app.close();
});

test("CORS native permite sólo origins/headers exactos y no anuncia credentials", async () => {
  const app = Fastify();
  await app.register(cors);
  app.post("/auth/native/login", async () => ({ ok: true }));
  const response = await app.inject({
    method: "OPTIONS",
    url: "/auth/native/login",
    headers: {
      origin: "capacitor://localhost",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-native-platform,x-native-app-build",
    },
  });
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "capacitor://localhost");
  assert.equal(response.headers["access-control-allow-credentials"], undefined);
  assert.match(String(response.headers["access-control-allow-headers"]), /Authorization/i);

  const denied = await app.inject({
    method: "OPTIONS",
    url: "/auth/native/login",
    headers: {
      origin: "https://evil.example.test",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization",
    },
  });
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
  await app.close();
});

test("logging redacta tokens y tickets raw incluso dentro de errores o query", () => {
  const token = generarTokenNativo("session");
  const ticket = generarTokenNativo("ws-ticket");
  const sanitized = sanitizarTextoLog(
    `Authorization Bearer ${token} /ws?ticket=${ticket}`,
  );
  assert.doesNotMatch(sanitized, /rsp[wn]1_/);
  assert.match(sanitized, /\[REDACTED\]/);
});
