import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { discoverMainActivities } from './native-release-readiness.mjs';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = join(frontRoot, '..');
const androidMain = join(frontRoot, 'android', 'app', 'src', 'main');

async function source(relativePath) {
  return readFile(join(frontRoot, relativePath), 'utf8');
}

async function productionTypescript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypescript(path);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) return [];
    return [await readFile(path, 'utf8')];
  }));
  return nested.flat();
}

function occurrences(value, pattern) {
  return value.match(pattern)?.length ?? 0;
}

test('el manifest Android falla cerrado ante cleartext y declara sólo permisos usados', async () => {
  const manifest = await source('android/app/src/main/AndroidManifest.xml');
  const applicationOffset = manifest.indexOf('<application');

  assert.ok(applicationOffset > 0);
  for (const permission of [
    'android.permission.INTERNET',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
  ]) {
    const declaration = `android:name="${permission}"`;
    const offset = manifest.indexOf(declaration);
    assert.ok(offset > 0, `falta ${permission}`);
    assert.ok(offset < applicationOffset, `${permission} debe preceder a application`);
  }

  for (const forbiddenPermission of [
    'android.permission.CAMERA',
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.MANAGE_EXTERNAL_STORAGE',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.POST_NOTIFICATIONS',
  ]) {
    assert.doesNotMatch(manifest, new RegExp(forbiddenPermission.replaceAll('.', '\\.') + '["<]'));
  }

  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.doesNotMatch(manifest, /android:networkSecurityConfig|android:requestLegacyExternalStorage/);
});

test('backup excluye sesión, installation id y logout pendiente de restore y transferencia', async () => {
  const [manifest, legacyRules, extractionRules, storage] = await Promise.all([
    source('android/app/src/main/AndroidManifest.xml'),
    source('android/app/src/main/res/xml/backup_rules.xml'),
    source('android/app/src/main/res/xml/data_extraction_rules.xml'),
    source('src/app/core/native/native-storage.service.ts'),
  ]);

  assert.match(manifest, /android:allowBackup="true"/);
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);

  for (const preferencesFile of [
    'WSSecureStorageSharedPreferences.xml',
    'RspNativeClient.xml',
  ]) {
    assert.equal(occurrences(legacyRules, new RegExp(preferencesFile, 'g')), 1);
    assert.equal(occurrences(extractionRules, new RegExp(preferencesFile, 'g')), 2);
  }
  assert.match(extractionRules, /<cloud-backup>[\s\S]*<\/cloud-backup>/);
  assert.match(extractionRules, /<device-transfer>[\s\S]*<\/device-transfer>/);
  assert.match(storage, /SECURE_PREFIX\s*=\s*'rsp_native_'/);
  assert.match(storage, /PREFERENCES_GROUP\s*=\s*'RspNativeClient'/);
  assert.match(storage, /setSynchronize\(false\)/);
  assert.match(storage, /KeychainAccess\.whenUnlockedThisDeviceOnly/);
});

test('FileProvider comparte sólo fotos app-scoped y cache mediante grants temporales', async () => {
  const [manifest, paths] = await Promise.all([
    source('android/app/src/main/AndroidManifest.xml'),
    source('android/app/src/main/res/xml/file_paths.xml'),
  ]);

  assert.match(manifest, /android:authorities="\$\{applicationId\}\.fileprovider"/);
  assert.match(manifest, /android:exported="false"/);
  assert.match(manifest, /android:grantUriPermissions="true"/);
  assert.match(paths, /<external-files-path\s+name="camera_images"\s+path="Pictures\/"\s*\/>/);
  assert.match(paths, /<cache-path\s+name="my_cache_images"\s+path="\."\s*\/>/);
  assert.doesNotMatch(paths, /<external-path\b|<root-path\b/);
});

test('release no fuerza debugging WebView ni configuración de red insegura', async () => {
  const [mainActivities, appBuild, capacitor] = await Promise.all([
    discoverMainActivities(join(androidMain, 'java')),
    source('android/app/build.gradle'),
    source('capacitor.config.ts'),
  ]);

  assert.ok(mainActivities.length > 0, 'falta MainActivity');
  for (const { source: mainActivity } of mainActivities) {
    assert.doesNotMatch(mainActivity, /setWebContentsDebuggingEnabled|WebView/);
  }
  assert.doesNotMatch(capacitor, /server\s*:|allowNavigation|cleartext|mixedContent/);
  assert.doesNotMatch(capacitor, /webContentsDebuggingEnabled\s*:\s*true/);
  assert.doesNotMatch(capacitor, /loggingBehavior\s*:\s*['"]production['"]/);
  assert.match(appBuild, /release\s*\{[\s\S]*?minifyEnabled false/);
});

test('el logging frontend no envía credenciales ni material de sesión a console', async () => {
  const files = await productionTypescript(join(frontRoot, 'src'));
  const calls = files.flatMap((content) =>
    content.match(/console\.(?:log|debug|info|warn|error)\s*\([\s\S]*?\);/g) ?? [],
  );
  assert.ok(calls.length > 0, 'el contrato debe inspeccionar al menos el error fatal de bootstrap');
  for (const call of calls) {
    assert.doesNotMatch(
      call,
      /authorization|bearer|credential|installation[_A-Z]?id|nativeToken|password|session_token|ws.?ticket/i,
    );
  }
});

test('el build nativo exige un appId de producción antes de sincronizar Android', async () => {
  const buildNative = await source('scripts/build-native.mjs');
  assert.match(buildNative, /assertProductionAppId/);
});

test('hay un único provider Ionic y un único registro condicional del Service Worker', async () => {
  const appConfig = await source('src/app/app.config.ts');
  assert.equal(occurrences(appConfig, /provideIonicAngular\s*\(/g), 1);
  assert.equal(occurrences(appConfig, /provideServiceWorker\s*\(/g), 1);
  assert.match(
    appConfig,
    /enabled:\s*String\(environment\.nativeBuildMode\) === 'web' && !isDevMode\(\)/,
  );
});

test('Git ignora APK, AAB, keystores y configuración local de signing', async () => {
  const [rootIgnore, androidIgnore] = await Promise.all([
    readFile(join(repositoryRoot, '.gitignore'), 'utf8'),
    readFile(join(frontRoot, 'android/.gitignore'), 'utf8'),
  ]);

  for (const pattern of ['*.apk', '*.aab', '*.jks', '*.keystore']) {
    assert.match(rootIgnore, new RegExp(`^${pattern.replaceAll('*', '\\*').replaceAll('.', '\\.')}\\s*$`, 'm'));
    assert.match(androidIgnore, new RegExp(`^${pattern.replaceAll('*', '\\*').replaceAll('.', '\\.')}\\s*$`, 'm'));
  }
  for (const name of ['key.properties', 'keystore.properties', 'signing.properties']) {
    assert.ok(rootIgnore.includes(`**/${name}`));
    assert.match(androidIgnore, new RegExp(`^${name.replaceAll('.', '\\.')}\\s*$`, 'm'));
  }
  const trackedSigningMaterial = spawnSync(
    'git',
    ['ls-files', '*.jks', '*.keystore', 'key.properties', 'keystore.properties', 'signing.properties'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  if (trackedSigningMaterial.error) throw trackedSigningMaterial.error;
  assert.equal(trackedSigningMaterial.status, 0);
  assert.equal(trackedSigningMaterial.stdout.trim(), '', 'hay material de signing versionado');
});
