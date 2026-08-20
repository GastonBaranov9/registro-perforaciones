import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createNativeBackendConfig, renderNativeEnvironment } from './native-backend-config.mjs';

test('el environment web conserva API y WebSocket same-origin', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../src/environments/environment.ts', import.meta.url)),
    'utf8',
  );
  assert.match(source, /serverURL:\s*["']\/api["']/);
  assert.match(source, /apiURL:\s*["']\/api\/["']/);
  assert.match(source, /globalThis\.location/);
  assert.match(source, /\/ws/);
  assert.doesNotMatch(source, /NATIVE_BACKEND_ORIGIN|native-backend\.example|localhost/);
});

test('Capacitor conserva assets locales y no usa server.url remoto', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../capacitor.config.ts', import.meta.url)),
    'utf8',
  );
  assert.match(source, /webDir:\s*['"]dist\/front\/browser['"]/);
  assert.doesNotMatch(source, /\bserver\s*:/);
});

test('genera API HTTPS y WebSocket WSS remotos desde un origin publico', () => {
  const config = createNativeBackendConfig('https://native-backend.example/');
  assert.deepEqual(config, {
    serverURL: 'https://native-backend.example/api',
    apiURL: 'https://native-backend.example/api/',
    wsUrl: 'wss://native-backend.example/ws',
  });
  const source = renderNativeEnvironment(config);
  assert.match(source, /https:\/\/native-backend\.example\/api\//);
  assert.match(source, /wss:\/\/native-backend\.example\/ws/);
  assert.doesNotMatch(source, /globalThis|window\.location|localhost|capacitor:\/\//);
});

test('preserva un puerto remoto explicito sin confundirlo con un path', () => {
  const config = createNativeBackendConfig('https://api.example:8443');
  assert.equal(config.apiURL, 'https://api.example:8443/api/');
  assert.equal(config.wsUrl, 'wss://api.example:8443/ws');
});

test('falla temprano si falta el backend native', () => {
  for (const value of [undefined, '']) {
    assert.throws(() => createNativeBackendConfig(value), /Falta NATIVE_BACKEND_ORIGIN/);
  }
});

test('rechaza URL relativa HTTP credenciales fragment path y query', () => {
  for (const value of [
    '/api',
    'http://api.example',
    'https://user:password@api.example',
    'https://api.example/#fragment',
    'https://api.example/base',
    'https://api.example/?tenant=1',
    ' https://api.example',
  ]) {
    assert.throws(() => createNativeBackendConfig(value), Error, value);
  }
});

test('rechaza hosts locales loopback y origins de WebView', () => {
  for (const value of [
    'https://localhost',
    'https://localhost.',
    'https://mobile.localhost',
    'https://127.0.0.1',
    'https://127.0.0.1.',
    'https://127.10.20.30',
    'https://[::1]',
    'https://0.0.0.0',
    'capacitor://localhost',
  ]) {
    assert.throws(() => createNativeBackendConfig(value), Error, value);
  }
});
