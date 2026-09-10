import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import cookies, { CSRF_COOKIE, SESSION_COOKIE } from "../src/plugins/cookies.ts";
import csrf from "../src/plugins/csrf.ts";
import originPlugin, { origenPublicoValido, origenWebsocketValido, registrarValidacionOrigin } from "../src/plugins/origin.ts";

test("Origin de producción protege mutaciones y WebSocket", () => {
  const origin = "https://perforaciones.example.test";
  const adicional="https://cliente.example.test";const permitidos=[origin,adicional];
  assert.equal(origenPublicoValido(true, origin,permitidos, "POST", origin, undefined), true);
  assert.equal(origenPublicoValido(true, origin,permitidos, "POST", adicional, undefined), true);
  assert.equal(origenPublicoValido(true, origin,permitidos, "POST", undefined, undefined), false);
  assert.equal(origenPublicoValido(true, origin,permitidos, "POST", "https://evil.example.test", undefined), false);
  assert.equal(origenPublicoValido(true, origin,permitidos, "GET", undefined, undefined), true);
  assert.equal(origenPublicoValido(true, origin,permitidos, "GET", origin, "websocket"), true);
  assert.equal(origenPublicoValido(true, origin,permitidos, "GET", adicional, "websocket"), false);
  assert.equal(origenPublicoValido(true, origin,permitidos, "GET", undefined, "websocket"), false);
  assert.equal(origenPublicoValido(false, undefined,[], "POST", undefined, undefined), true);
});

test("CORS y Origin comparten allowlist HTTP sin debilitar CSRF ni WebSocket",async()=>{
  const canonical="https://app.example.test";const additional="https://cliente.example.test";const allowed=[canonical,additional];
  const app=Fastify();
  await app.register(cookies);
  await app.register(fastifyCors,{origin:allowed,methods:["GET","POST","OPTIONS"],allowedHeaders:["Content-Type","X-CSRF-Token"],credentials:true});
  await registrarValidacionOrigin(app,{production:true,publicOrigin:canonical,corsOrigins:allowed,nativeCorsOrigins:["https://localhost","capacitor://localhost"]});
  await app.register(csrf);
  app.get("/recurso",async()=>({ok:true}));
  app.post("/recurso",async()=>({ok:true}));

  const preflight=await app.inject({method:"OPTIONS",url:"/recurso",headers:{origin:additional,"access-control-request-method":"POST","access-control-request-headers":"x-csrf-token"}});
  assert.equal(preflight.statusCode,204);assert.equal(preflight.headers["access-control-allow-origin"],additional);
  assert.equal((await app.inject({method:"GET",url:"/recurso",headers:{origin:additional}})).statusCode,200);
  assert.equal((await app.inject({method:"GET",url:"/recurso",headers:{origin:"https://evil.example.test"}})).statusCode,403);
  assert.equal((await app.inject({method:"POST",url:"/recurso",headers:{origin:additional},cookies:{[SESSION_COOKIE]:"jwt"}})).statusCode,403);
  assert.equal((await app.inject({method:"POST",url:"/recurso",headers:{origin:additional,"x-csrf-token":"control"},cookies:{[SESSION_COOKIE]:"jwt",[CSRF_COOKIE]:"control"}})).statusCode,200);
  assert.equal(origenPublicoValido(true,canonical,allowed,"GET",additional,"websocket"),false);
  await app.close();
});

test("el plugin Origin usa la configuracion runtime al registrarse", async () => {
  const canonical = "https://app.example.test";
  const app = Fastify();
  await app.register(originPlugin, {
    runtime: { production: true, publicOrigin: canonical, corsOrigins: [canonical], nativeCorsOrigins: ["https://localhost","capacitor://localhost"] },
  });
  app.post("/recurso", async () => ({ ok: true }));

  assert.equal((await app.inject({ method: "POST", url: "/recurso", headers: { origin: canonical } })).statusCode, 200);
  assert.equal((await app.inject({
    method: "POST",
    url: "/recurso",
    headers: { origin: "https://evil.example.test" },
  })).statusCode, 403);
  await app.close();
});

test("Origin native queda separado del web y nunca relaja WebSocket web", async () => {
  const canonical = "https://app.example.test";
  const nativeOrigins = ["https://localhost", "capacitor://localhost"];
  const app = Fastify();
  await registrarValidacionOrigin(app, {
    production: true,
    publicOrigin: canonical,
    corsOrigins: [canonical],
    nativeCorsOrigins: nativeOrigins,
  });
  app.post("/auth/native/login", async () => ({ ok: true }));
  app.post("/business", async () => ({ ok: true }));
  app.get("/ws-control", async () => ({ ok: true }));

  assert.equal((await app.inject({
    method: "POST", url: "/auth/native/login", headers: { origin: "https://localhost" },
  })).statusCode, 200);
  assert.equal((await app.inject({
    method: "POST", url: "/auth/native/login", headers: { origin: canonical },
  })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/auth/native/login" })).statusCode, 200);
  assert.equal((await app.inject({
    method: "POST", url: "/business",
    headers: { origin: "capacitor://localhost", authorization: "Bearer fixture" },
  })).statusCode, 200);
  assert.equal((await app.inject({
    method: "GET", url: "/ws-control",
    headers: { origin: "https://localhost", upgrade: "websocket" },
  })).statusCode, 403);
  await app.close();
});

test("la matriz WebSocket separa ticket native de cookie web por Origin", () => {
  const publicOrigin = "https://app.example.test";
  const nativeOrigins = ["https://localhost", "capacitor://localhost"];
  assert.equal(origenWebsocketValido(true, publicOrigin, nativeOrigins, "/ws", publicOrigin), true);
  assert.equal(origenWebsocketValido(true, publicOrigin, nativeOrigins, "/ws", "https://localhost"), false);
  assert.equal(origenWebsocketValido(true, publicOrigin, nativeOrigins, "/ws?ticket=rspw1_x", "https://localhost"), true);
  assert.equal(origenWebsocketValido(true, publicOrigin, nativeOrigins, "/ws?ticket=rspw1_x", "capacitor://localhost"), true);
  assert.equal(origenWebsocketValido(true, publicOrigin, nativeOrigins, "/ws?ticket=rspw1_x", publicOrigin), false);
  assert.equal(origenWebsocketValido(true, publicOrigin, nativeOrigins, "/ws?ticket=rspw1_x", "https://evil.example.test"), false);
  assert.equal(origenWebsocketValido(true, publicOrigin, nativeOrigins, "/ws", undefined), false);
});
