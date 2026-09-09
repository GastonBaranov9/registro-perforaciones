import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { confiarSoloEnProxyEdge } from "../src/config/trust-proxy.ts";
import rateLimitPlugin from "../src/plugins/rate-limit.ts";
import { MemoryRateLimiter } from "../src/services/rate-limit-service.ts";

async function withHandshakeLimit<T>(limit: number, run: () => Promise<T>): Promise<T> {
  const previous = process.env.RATE_LIMIT_NATIVE_WS_TICKET_MAX;
  process.env.RATE_LIMIT_NATIVE_WS_TICKET_MAX = String(limit);
  try { return await run(); }
  finally {
    if (previous === undefined) delete process.env.RATE_LIMIT_NATIVE_WS_TICKET_MAX;
    else process.env.RATE_LIMIT_NATIVE_WS_TICKET_MAX = previous;
  }
}

test("handshake native limita por request.ip antes del handler de redencion", async () => {
  await withHandshakeLimit(2, async () => {
    const app = Fastify({ logger: false, trustProxy: confiarSoloEnProxyEdge });
    let redemptions = 0;
    await app.register(rateLimitPlugin);
    app.get("/ws", { onRequest: [app.rateLimitNativeWsHandshake] }, async () => {
      redemptions += 1;
      return { ok: true };
    });
    await app.ready();
    try {
      const headers = { "x-forwarded-for": "198.51.100.25, 203.0.113.44" };
      assert.equal((await app.inject({ method: "GET", url: "/ws?ticket=rspw1_a", remoteAddress: "172.20.0.5", headers })).statusCode, 200);
      assert.equal((await app.inject({ method: "GET", url: "/ws?ticket=rspw1_b", remoteAddress: "172.20.0.5", headers })).statusCode, 200);
      const limited = await app.inject({ method: "GET", url: "/ws?ticket=rspw1_c", remoteAddress: "172.20.0.5", headers });
      assert.equal(limited.statusCode, 429);
      assert.ok(Number(limited.headers["retry-after"]) >= 1);
      assert.equal(redemptions, 2);

      const otherIp = await app.inject({
        method: "GET", url: "/ws?ticket=rspw1_d", remoteAddress: "172.20.0.6",
        headers: { "x-forwarded-for": "198.51.100.26, 203.0.113.45" },
      });
      assert.equal(otherIp.statusCode, 200);
      assert.equal(redemptions, 3);
    } finally { await app.close(); }
  });
});

test("el bucket native se recupera al cerrar la ventana", () => {
  const limiter = new MemoryRateLimiter(1, 1_000);
  assert.equal(limiter.consume("native-ws:203.0.113.1", 0).allowed, true);
  assert.equal(limiter.consume("native-ws:203.0.113.1", 999).allowed, false);
  assert.equal(limiter.consume("native-ws:203.0.113.1", 1_000).allowed, true);
});

