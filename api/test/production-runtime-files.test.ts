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
  const proxy = await fs.readFile(path.join(repo, "proxy", "http.conf.template"), "utf8");
  assert.match(proxy, new RegExp(`client_max_body_size ${PROXY_UPLOAD_LIMIT_MIB}m;`));
  assert.match(proxy, /location \/api\//);
  assert.match(proxy, /location \/ws/);
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
