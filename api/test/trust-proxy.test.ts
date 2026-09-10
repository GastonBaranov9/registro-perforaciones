import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Fastify from "fastify";
import { confiarSoloEnPeerInmediato } from "../src/config/trust-proxy.ts";
import { MemoryRateLimiter } from "../src/services/rate-limit-service.ts";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function composeService(source: string, name: string): string {
  const match = new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\r?$|^volumes:\\r?$|^networks:\\r?$)`, "m").exec(source);
  assert.ok(match, `falta el servicio ${name}`);
  return match[0];
}

function nginxLocation(source: string, declaration: string): string {
  const match = new RegExp(`^    location ${declaration.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")} \\{([\\s\\S]*?)^    \\}`, "m").exec(source);
  assert.ok(match, `falta location ${declaration}`);
  return match[0];
}

test("trustProxy conserva exactamente un hop y no atribuye identidad al peer", () => {
  for (const peer of ["172.20.0.5", "2001:db8::5", "198.51.100.80"]) {
    assert.equal(confiarSoloEnPeerInmediato(peer, 0), true);
    assert.equal(confiarSoloEnPeerInmediato(peer, 1), false);
    assert.equal(confiarSoloEnPeerInmediato(peer, 2), false);
  }
});

test("Fastify usa sólo el valor forwarded derecho para IP, host y protocolo", async () => {
  const app = Fastify({ trustProxy: confiarSoloEnPeerInmediato });
  app.get("/proxy", async (req) => ({
    protocol: req.protocol,
    host: req.host,
    ip: req.ip,
    ips: req.ips,
  }));

  for (const remoteAddress of ["172.20.0.5", "2001:db8::5"]) {
    const withoutForwarding = await app.inject({
      method: "GET",
      url: "/proxy",
      remoteAddress,
    });
    assert.deepEqual(withoutForwarding.json(), {
      protocol: "http",
      host: "localhost:80",
      ip: remoteAddress,
      ips: [remoteAddress],
    });

    const singleForwarded = await app.inject({
      method: "GET",
      url: "/proxy",
      remoteAddress,
      headers: {
        "x-forwarded-for": "203.0.113.30",
        "x-forwarded-host": "publico.example",
        "x-forwarded-proto": "https",
      },
    });
    assert.deepEqual(singleForwarded.json(), {
      protocol: "https",
      host: "publico.example",
      ip: "203.0.113.30",
      ips: [remoteAddress, "203.0.113.30"],
    });

    const response = await app.inject({
      method: "GET",
      url: "/proxy",
      remoteAddress,
      headers: {
        "x-forwarded-for": "192.0.2.10, 198.51.100.20, 203.0.113.30",
        "x-forwarded-host": "aportado-por-cliente.example, publico.example",
        "x-forwarded-proto": "http, https",
      },
    });
    assert.deepEqual(response.json(), {
      protocol: "https",
      host: "publico.example",
      ip: "203.0.113.30",
      ips: [remoteAddress, "203.0.113.30"],
    });
  }
  await app.close();
});

test("un peer directo puede elegir su bucket y por eso queda fuera del contrato público", async () => {
  const app = Fastify({ trustProxy: confiarSoloEnPeerInmediato });
  const limiter = new MemoryRateLimiter(1, 60_000);
  app.get("/limited", async (req, reply) => {
    const result = limiter.consume(`api:ip:${req.ip}`);
    return reply.code(result.allowed ? 200 : 429).send({ ip: req.ip });
  });

  const request = (forwardedFor: string) => app.inject({
    method: "GET",
    url: "/limited",
    remoteAddress: "198.51.100.80",
    headers: { "x-forwarded-for": forwardedFor },
  });
  assert.equal((await request("192.0.2.10")).statusCode, 200);
  assert.equal((await request("192.0.2.11")).statusCode, 200);
  assert.equal((await request("192.0.2.11")).statusCode, 429);
  await app.close();
});

test("production no publica la API y Nginx reemplaza forwarding HTTP y WebSocket", async () => {
  const [compose, nginx] = await Promise.all([
    readFile(join(repositoryRoot, "docker-compose.production.yaml"), "utf8"),
    readFile(join(repositoryRoot, "proxy", "https.conf.template"), "utf8"),
  ]);
  const api = composeService(compose, "api");
  const proxy = composeService(compose, "proxy");
  assert.doesNotMatch(api, /^    ports:/m);
  assert.match(api, /^    expose:\r?\n      - "3000"/m);
  assert.match(api, /^      - edge$/m);
  assert.match(api, /^      - backend$/m);
  assert.match(proxy, /^    ports:/m);
  assert.match(proxy, /\$\{HTTP_PORT:-80\}:80"/);
  assert.match(proxy, /\$\{HTTPS_PORT:-443\}:443"/);

  for (const location of [nginxLocation(nginx, "/api/"), nginxLocation(nginx, "= /ws")]) {
    assert.match(location, /proxy_pass http:\/\/api:3000/);
    assert.match(location, /proxy_set_header X-Forwarded-For \$remote_addr;/);
    assert.match(location, /proxy_set_header X-Forwarded-Proto https;/);
    assert.match(location, /proxy_set_header X-Forwarded-Host \$host;/);
    assert.match(location, /proxy_set_header Host \$host;/);
    assert.doesNotMatch(location, /\$proxy_add_x_forwarded_for/);
  }
});
