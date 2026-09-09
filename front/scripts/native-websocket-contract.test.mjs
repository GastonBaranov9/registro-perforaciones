import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const service = await readFile(
  join(root, 'src', 'app', 'shared', 'services', 'websocket.service.ts'),
  'utf8',
);
const backendConfig = await readFile(
  join(root, 'src', 'app', 'core', 'native', 'native-backend-config.service.ts'),
  'utf8',
);

test('native websocket usa ticket HTTP, URL WSS validada y no storage', () => {
  assert.match(backendConfig, /wsTicket:\s*'\/api\/auth\/native\/ws-ticket'/);
  assert.match(service, /NATIVE_AUTH_PUBLIC_PATHS\.wsTicket/);
  assert.match(service, /httpClient\.post/);
  assert.match(service, /new URL\('\/ws', this\.backendConfig\.origin\(\)\)/);
  assert.match(service, /wsUrl\.protocol = 'wss:'/);
  assert.match(service, /searchParams\.set\('ticket', response\.ticket\)/);
  assert.doesNotMatch(service, /localStorage|sessionStorage|Preferences|SecureStorage/);
  assert.doesNotMatch(service, /Authorization.*new WebSocket|new WebSocket\([^)]*Bearer/si);
});

test('native reconnect exige estado authenticated y protege generation', () => {
  assert.match(service, /state\(\) === 'authenticated'/);
  assert.match(service, /generationIsCurrent\(generation\)/);
  assert.match(service, /this\.reconnectGeneration/);
});
