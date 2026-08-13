import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { origenPublicoValido } from "../src/plugins/origin.ts";

test("Origin de producción protege mutaciones y WebSocket", () => {
  const origin = "https://perforaciones.example.test";
  assert.equal(origenPublicoValido(true, origin, "POST", origin, undefined), true);
  assert.equal(origenPublicoValido(true, origin, "POST", undefined, undefined), false);
  assert.equal(origenPublicoValido(true, origin, "POST", "https://evil.example.test", undefined), false);
  assert.equal(origenPublicoValido(true, origin, "GET", undefined, undefined), true);
  assert.equal(origenPublicoValido(true, origin, "GET", origin, "websocket"), true);
  assert.equal(origenPublicoValido(true, origin, "GET", undefined, "websocket"), false);
  assert.equal(origenPublicoValido(false, undefined, "POST", undefined, undefined), true);
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
