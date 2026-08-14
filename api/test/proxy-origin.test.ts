import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import cookies, { CSRF_COOKIE, SESSION_COOKIE } from "../src/plugins/cookies.ts";
import csrf from "../src/plugins/csrf.ts";
import { origenPublicoValido, registrarValidacionOrigin } from "../src/plugins/origin.ts";

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
  await registrarValidacionOrigin(app,{production:true,publicOrigin:canonical,corsOrigins:allowed});
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

test("Fastify confía exactamente un salto para protocolo e IP", async () => {
  const app = Fastify({ trustProxy: 1 });
  app.get("/proxy", async (req) => ({ protocol: req.protocol, ip: req.ip }));
  const response = await app.inject({
    method: "GET",
    url: "/proxy",
    remoteAddress: "172.20.0.5",
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-for": "198.51.100.25, 203.0.113.44",
    },
  });
  assert.deepEqual(response.json(), { protocol: "https", ip: "203.0.113.44" });
  await app.close();
});
