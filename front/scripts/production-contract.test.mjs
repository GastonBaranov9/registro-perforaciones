import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));

test('solo publica comandos de build web autenticables', async () => {
  const packageJson = JSON.parse(await readFile(join(frontRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['build:production'], 'ng build --configuration production');
  assert.equal(packageJson.scripts['test:production-build'], 'node scripts/test-production-build.mjs');
  assert.equal(packageJson.scripts['build:native'], undefined);
  assert.equal(packageJson.scripts['capacitor:sync'], undefined);
  assert.equal(packageJson.scripts['test:build-targets'], undefined);

  for (const removed of [
    'scripts/build-native.mjs',
    'scripts/native-backend-config.mjs',
    'src/environments/environment.native.generated.ts',
  ]) {
    await assert.rejects(access(join(frontRoot, removed)), undefined, `${removed} no debe existir`);
  }
});

test('Angular conserva solo production web y development', async () => {
  const angular = JSON.parse(await readFile(join(frontRoot, 'angular.json'), 'utf8'));
  const build = angular.projects.front.architect.build;
  assert.equal(build.defaultConfiguration, 'production');
  assert.deepEqual(Object.keys(build.configurations).sort(), ['development', 'production']);
  assert.equal(build.configurations.native, undefined);
  assert.equal(JSON.stringify(angular).includes('environment.native.generated.ts'), false);
});

test('web conserva API y WebSocket same-origin y Capacitor solo como base', async () => {
  const environment = await readFile(join(frontRoot, 'src/environments/environment.ts'), 'utf8');
  assert.match(environment, /serverURL:\s*["']\/api["']/);
  assert.match(environment, /apiURL:\s*["']\/api\/["']/);
  assert.match(environment, /globalThis\.location\.protocol/);
  assert.match(environment, /globalThis\.location\.host/);
  assert.doesNotMatch(environment, /NATIVE_BACKEND_ORIGIN|https?:\/\//);

  const capacitor = await readFile(join(frontRoot, 'capacitor.config.ts'), 'utf8');
  assert.match(capacitor, /webDir:\s*'dist\/front\/browser'/);
  assert.doesNotMatch(capacitor, /server\s*:|url\s*:/);
});
