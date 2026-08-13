import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PROXY_UPLOAD_LIMIT_MIB } from "../src/constants/fotos.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("Compose production mantiene PostgreSQL interno y fotos en volumen dedicado", async () => {
  const compose = await fs.readFile(path.join(repo, "docker-compose.production.yaml"), "utf8");
  const postgres = compose.slice(compose.indexOf("  postgres:"), compose.indexOf("\n  api:"));
  assert.doesNotMatch(postgres, /^\s+ports:/m);
  assert.match(postgres, /expose:\s*\n\s+- "5432"/);
  assert.match(compose, /raul_silva_fotos:\/var\/lib\/registro-perforaciones/);
  assert.match(compose, /FOTOS_DIR: \/var\/lib\/registro-perforaciones\/fotos/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /restart: unless-stopped/);
});

test("proxy y API comparten el contrato de upload", async () => {
  const proxy = await fs.readFile(path.join(repo, "proxy", "https.conf.template"), "utf8");
  assert.match(proxy, new RegExp(`client_max_body_size ${PROXY_UPLOAD_LIMIT_MIB}m;`));
  assert.match(proxy, /location \/api\//);
  assert.match(proxy, /location = \/ws/);
});

test("proxy HTTPS es same-origin, redirige y sobrescribe forwarding", async () => {
  const compose = await fs.readFile(path.join(repo, "docker-compose.production.yaml"), "utf8");
  const proxy = await fs.readFile(path.join(repo, "proxy", "https.conf.template"), "utf8");
  assert.match(compose, /HTTPS_PORT:-443}:443/);
  assert.match(compose, /TLS_CERT_FILE:\?Falta TLS_CERT_FILE/);
  assert.match(compose, /TLS_KEY_FILE:\?Falta TLS_KEY_FILE/);
  assert.doesNotMatch(compose.slice(compose.indexOf("  api:"), compose.indexOf("\n  front:")), /^\s+ports:/m);
  assert.match(proxy, /return 308 \$\{PUBLIC_ORIGIN\}\$request_uri/);
  assert.match(proxy, /proxy_pass http:\/\/api:3000\//);
  assert.match(proxy, /proxy_set_header X-Forwarded-For \$remote_addr/);
  assert.match(proxy, /proxy_set_header X-Forwarded-Proto https/);
  assert.match(proxy, /if \(\$host != "\$\{PUBLIC_HOST\}"\) \{ return 421; \}/);
  assert.match(proxy, /ssl_protocols TLSv1\.2 TLSv1\.3/);
  assert.doesNotMatch(proxy, /ssl_protocols[^;]*(?:SSLv3|TLSv1\.0|TLSv1\.1)/);
});

test("imágenes base tienen versiones explícitas y API conserva usuario no-root", async () => {
  const apiDockerfile = await fs.readFile(path.join(repo, "api", "Dockerfile"), "utf8");
  const frontDockerfile = await fs.readFile(path.join(repo, "front", "Dockerfile"), "utf8");
  assert.match(apiDockerfile, /^FROM node:24\.18\.0-alpine@sha256:[a-f0-9]{64} AS base/m);
  assert.match(frontDockerfile, /^FROM nginx:1\.30\.4-alpine3\.24@sha256:[a-f0-9]{64} AS production/m);
  assert.doesNotMatch(`${apiDockerfile}\n${frontDockerfile}`, /FROM \S+:latest/);
  assert.match(apiDockerfile, /USER node:node/);
  assert.match(apiDockerfile, /chown -R node:node \/var\/lib\/registro-perforaciones\/fotos/);
});
