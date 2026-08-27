import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));

test('mantiene builds web independientes y publica targets native explícitos', async () => {
  const packageJson = JSON.parse(await readFile(join(frontRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['build:production'], 'ng build --configuration production');
  assert.equal(packageJson.scripts['test:production-build'], 'node scripts/test-production-build.mjs');
  assert.equal(packageJson.scripts['build:native'], 'node scripts/build-native.mjs production');
  assert.equal(packageJson.scripts['build:native:development'], 'node scripts/build-native.mjs development');
  assert.equal(packageJson.scripts['build:native:production'], 'node scripts/build-native.mjs production');
  assert.equal(packageJson.scripts['capacitor:sync'], undefined);

  await access(join(frontRoot, 'scripts/build-native.mjs'));
  await access(join(frontRoot, 'scripts/native-backend-config.mjs'));
});

test('Angular separa configuraciones web y native sin service worker remoto', async () => {
  const angular = JSON.parse(await readFile(join(frontRoot, 'angular.json'), 'utf8'));
  const build = angular.projects.front.architect.build;
  assert.equal(build.defaultConfiguration, 'production');
  assert.deepEqual(Object.keys(build.configurations).sort(), [
    'development',
    'native-development',
    'native-production',
    'production',
  ]);
  for (const mode of ['native-development', 'native-production']) {
    const configuration = build.configurations[mode];
    assert.equal(configuration.serviceWorker, false);
    assert.equal(configuration.index.input, 'src/index.native.generated.html');
    assert.deepEqual(configuration.fileReplacements, [{
      replace: 'src/environments/environment.ts',
      with: 'src/environments/environment.native.generated.ts',
    }]);
  }
});

test('web conserva API/WebSocket same-origin y Capacitor carga assets locales', async () => {
  const environment = await readFile(join(frontRoot, 'src/environments/environment.ts'), 'utf8');
  assert.match(environment, /serverURL:\s*["']\/api["']/);
  assert.match(environment, /apiURL:\s*["']\/api\/["']/);
  assert.match(environment, /globalThis\.location\.protocol/);
  assert.match(environment, /globalThis\.location\.host/);
  assert.match(environment, /nativeBackendOrigin:\s*null/);
  assert.doesNotMatch(environment, /NATIVE_BACKEND_ORIGIN|https?:\/\//);

  const capacitor = await readFile(join(frontRoot, 'capacitor.config.ts'), 'utf8');
  assert.match(capacitor, /webDir:\s*'dist\/front\/browser'/);
  assert.doesNotMatch(capacitor, /server\s*:|url\s*:/);
});

test('build native exige origin, genera CSP local y siempre retira temporales', async () => {
  const source = await readFile(join(frontRoot, 'scripts/build-native.mjs'), 'utf8');
  assert.match(source, /process\.env\.NATIVE_BACKEND_ORIGIN/);
  assert.match(source, /validateNativeBackendOrigin/);
  assert.match(source, /assertProductionAppId/);
  assert.match(source, /Content-Security-Policy/);
  assert.match(source, /finally/);
  assert.match(source, /rm\(environmentPath, \{ force: true \}\)/);
  assert.doesNotMatch(source, /server\.url|allowNavigation/);

  const appConfig = await readFile(join(frontRoot, 'src/app/app.config.ts'), 'utf8');
  assert.match(appConfig, /enabled:\s*String\(environment\.nativeBuildMode\) === 'web' && !isDevMode\(\)/);
});
