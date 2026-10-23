// Compose config only: does not contact the daemon or create any containers.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = mkdtempSync(join(tmpdir(), 'rsp-smoke-config-'));
try {
  const envFile = join(root, 'fixture.env');
  const fixture = {
    PGUSER: 'fixture', PGPASSWORD: 'fixture', PGDATABASE: 'fixture',
    FASTIFY_SECRET: 'fixture', NATIVE_TOKEN_HMAC_SECRET: 'fixture',
    MIN_NATIVE_ANDROID_BUILD: '1', MIN_NATIVE_IOS_BUILD: '1',
    PUBLIC_HOST: 'app.example.test', PUBLIC_ORIGIN: 'https://app.example.test',
    APP_HOST: 'app.example.test', API_HOST: 'api.example.test',
    API_IMAGE_REF: 'fixture-api:test', FRONT_IMAGE_REF: 'fixture-front:test',
    BACKUP_DIR: root.replaceAll('\\', '/'),
    TLS_CERT_FILE: join(root, 'fixture.crt').replaceAll('\\', '/'),
    TLS_KEY_FILE: join(root, 'fixture.key').replaceAll('\\', '/'),
    MAP_STATIC_URL_TEMPLATE: 'https://maps.example.test/{latitud}/{longitud}',
    MAP_STATIC_ALLOWED_HOST: 'maps.example.test', MAP_STATIC_API_KEY: 'fixture', MAP_STATIC_ATTRIBUTION: 'fixture',
    HTTP_BIND_ADDRESS: '127.0.0.1', HTTPS_BIND_ADDRESS: '127.0.0.1', HTTPS_PORT: '8443',
  };
  writeFileSync(envFile, Object.entries(fixture).map(([k, v]) => `${k}=${v}`).join('\n'));
  for (const port of [18443, 29443]) {
    const config = JSON.parse(execFileSync('docker', ['compose', '--profile', 'ops', '--project-name', 'rsp-config-mock', '--env-file', envFile,
      '-f', resolve('docker-compose.production.yaml'), '-f', resolve('ops/smoke-proxy.compose.yaml'), 'config', '--format', 'json'],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...fixture, SMOKE_INTERNAL_PORT: String(port) } }));
    const { proxy, 'smoke-proxy': smoke } = config.services;
    assert.equal(smoke.ports.length, 1);
    assert.equal(smoke.ports[0].host_ip, '127.0.0.1');
    assert.equal(String(smoke.ports[0].published), String(port));
    assert.equal(smoke.ports[0].target, 443);
    for (const key of ['image', 'entrypoint', 'environment', 'volumes', 'networks']) assert.deepEqual(smoke[key], proxy[key], key);
    assert(smoke.volumes.every(v => v.read_only));
    assert.equal(smoke.restart, 'no');
    assert.equal(String(proxy.ports.find(p => p.target === 443).published), '8443');
    console.log(`PASS private proxy config port ${port}; identical routes/TLS, loopback only`);
  }
} finally {
  assert.equal(resolve(dirname(root)), resolve(tmpdir()));
  assert(basename(root).startsWith('rsp-smoke-config-'));
  rmSync(root, { recursive: true, force: true });
}
