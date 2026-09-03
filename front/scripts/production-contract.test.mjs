import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  deriveNativeWebsocketOrigin,
  validateNativeBackendOrigin,
} from './native-backend-config.mjs';

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

  const main = await readFile(join(frontRoot, 'src/main.ts'), 'utf8');
  assert.match(main, /bootstrapApplication\(App, appConfig\)/);
  assert.doesNotMatch(main, /provideServiceWorker|ngsw-worker\.js|mergeApplicationConfig|isDevMode/);

  const appConfig = await readFile(join(frontRoot, 'src/app/app.config.ts'), 'utf8');
  assert.match(appConfig, /provideServiceWorker\('ngsw-worker\.js'/);
  assert.match(appConfig, /enabled:\s*String\(environment\.nativeBuildMode\) === 'web' && !isDevMode\(\)/);
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
  assert.match(source, /deriveNativeWebsocketOrigin/);
  assert.match(source, /connect-src 'self' \$\{origin\} \$\{websocketOrigin\}/);
  assert.doesNotMatch(source, /server\.url|allowNavigation/);
});

test('CSP native deriva HTTPS a WSS con el mismo host y puerto', () => {
  assert.equal(
    deriveNativeWebsocketOrigin('https://api.example.com'),
    'wss://api.example.com',
  );
  assert.equal(
    deriveNativeWebsocketOrigin('https://api.example.com:8443'),
    'wss://api.example.com:8443',
  );
});

test('derivación WSS falla cerrado y no agrega hosts ni wildcard', async () => {
  assert.throws(() => deriveNativeWebsocketOrigin('http://api.example.com'));
  assert.throws(() => deriveNativeWebsocketOrigin('https://api.example.com/api'));
  assert.equal(validateNativeBackendOrigin('https://api.example.com', 'development'), 'https://api.example.com');
  const source = await readFile(join(frontRoot, 'scripts/build-native.mjs'), 'utf8');
  assert.doesNotMatch(source, /connect-src[^\n]*\bwss:\s*['"]?/);
  assert.doesNotMatch(source, /connect-src[^\n]*\*/);
});

test('Android mantiene el minSdk requerido por Capacitor 8', async () => {
  const variables = await readFile(join(frontRoot, 'android/variables.gradle'), 'utf8');
  const rootBuild = await readFile(join(frontRoot, 'android/build.gradle'), 'utf8');
  const wrapper = await readFile(join(frontRoot, 'android/gradle/wrapper/gradle-wrapper.properties'), 'utf8');
  const appBuild = await readFile(join(frontRoot, 'android/app/build.gradle'), 'utf8');
  const capacitorBuild = await readFile(join(frontRoot, 'android/app/capacitor.build.gradle'), 'utf8');
  const packageJson = JSON.parse(await readFile(join(frontRoot, 'package.json'), 'utf8'));
  assert.match(variables, /minSdkVersion\s*=\s*24/);
  assert.match(variables, /compileSdkVersion\s*=\s*36/);
  assert.match(variables, /targetSdkVersion\s*=\s*36/);
  assert.match(rootBuild, /com\.android\.tools\.build:gradle:8\.13\.0/);
  assert.match(wrapper, /gradle-8\.13(?:\.0)?-all\.zip/);
  assert.match(appBuild, /minSdkVersion rootProject\.ext\.minSdkVersion/);
  assert.match(capacitorBuild, /project\(':capacitor-app'\)/);
  assert.equal(packageJson.dependencies['@capacitor/core'], '8.5.0');
  assert.equal(packageJson.dependencies['@capacitor/android'], '8.5.0');
  assert.equal(packageJson.dependencies['@capacitor/app'], '8.0.0');
  assert.equal(packageJson.dependencies['@capacitor/preferences'], '8.0.0');
  assert.equal(packageJson.dependencies['@aparajita/capacitor-secure-storage'], '8.0.0');
});
