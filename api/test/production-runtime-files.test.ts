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

test("Compose development migra automáticamente y conserva API host",async()=>{
  const compose=await fs.readFile(path.join(repo,"docker-compose.development.yaml"),"utf8");
  assert.match(compose,/\n  migrate:\n/);
  assert.match(compose,/command: \["npm", "run", "db:migrate"\]/);
  assert.match(compose,/PGHOST: postgres/);
  assert.match(compose,/PGPORT: "5432"/);
  assert.match(compose,/condition: service_healthy/);
  assert.match(compose,/restart: "no"/);
  assert.match(compose,/condition: service_completed_successfully/);
  assert.match(compose,/\n  database-ready:\n/);
  assert.match(compose,/DEVELOPMENT_DB_READY/);
  assert.match(compose,/127\.0\.0\.1:\$\{PGPORT\}:5432/);
  assert.doesNotMatch(compose,/adopt-current-schema/);
  assert.doesNotMatch(compose,/container_name:/);
});

test("deploy y rollback persisten una fuente de verdad separada de secretos",async()=>{
  const deploy=await fs.readFile(path.join(repo,"ops","deploy.ps1"),"utf8");
  const rollback=await fs.readFile(path.join(repo,"ops","rollback.ps1"),"utf8");
  const state=await fs.readFile(path.join(repo,"ops","deployment-state.ps1"),"utf8");
  const posix=await fs.readFile(path.join(repo,"ops","deployment-state.sh"),"utf8");
  for(const script of [deploy,rollback]){
    assert.match(script,/DeploymentStateFile/);
    assert.match(script,/--env-file[^\n]+deploymentPath/);
    assert.match(script,/Write-DeploymentStateAtomic/);
    assert.match(script,/Assert-ComposeState/);
  }
  assert.match(deploy,/smoke_ok[\s\S]+Write-DeploymentStateAtomic/);
  assert.match(rollback,/Smoke posterior[\s\S]+Write-DeploymentStateAtomic/);
  assert.match(state,/DEPLOY_CONFIG_SHA256/);
  assert.doesNotMatch(state,/FASTIFY_SECRET|PGPASSWORD|DATABASE_URL/);
  assert.match(posix,/deployment_state_write_atomic/);
  assert.match(posix,/mv -f/);
  const deployPosix=await fs.readFile(path.join(repo,"ops","deploy.sh"),"utf8");
  const rollbackPosix=await fs.readFile(path.join(repo,"ops","rollback.sh"),"utf8");
  assert.match(deployPosix,/smoke=.*smoke\.sh[\s\S]+deployment_state_write_atomic/);
  assert.match(rollbackPosix,/smoke=.*smoke\.sh[\s\S]+deployment_state_write_atomic/);
  assert.match(deployPosix,/--env-file "\$DEPLOYMENT_STATE_FILE"/);
  assert.match(rollbackPosix,/--env-file "\$DEPLOYMENT_STATE_FILE"/);
});
