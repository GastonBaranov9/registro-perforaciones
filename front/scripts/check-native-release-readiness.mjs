import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNativeBackendOrigin } from './native-backend-config.mjs';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const tests = (await readdir(join(frontRoot, 'scripts')))
  .filter((name) => /^native-.*\.test\.mjs$/.test(name))
  .map((name) => join('scripts', name));
const testResult = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: frontRoot,
  env: process.env,
  stdio: 'inherit',
});
if (testResult.error) throw testResult.error;
if (testResult.status !== 0) process.exit(testResult.status ?? 1);

const [capacitor, appBuild, strings] = await Promise.all([
  readFile(join(frontRoot, 'capacitor.config.ts'), 'utf8'),
  readFile(join(frontRoot, 'android/app/build.gradle'), 'utf8'),
  readFile(join(frontRoot, 'android/app/src/main/res/values/strings.xml'), 'utf8'),
]);

const results = [];
function result(status, item, detail) {
  results.push({ status, item, detail });
}

try {
  validateNativeBackendOrigin(process.env.NATIVE_BACKEND_ORIGIN, 'production');
  result('READY', 'backend origin syntax', 'es un origin HTTPS productivo válido');
  result(
    'BLOCKED',
    'backend production origin',
    'HUMAN_DECISION_REQUIRED: confirmar que el origin validado es el definitivo',
  );
} catch {
  result('BLOCKED', 'backend production origin', 'falta un origin HTTPS definitivo y válido');
}

const appId = capacitor.match(/appId:\s*['"]([^'"]+)['"]/)?.[1];
if (!appId || appId === 'com.example.app') {
  result('BLOCKED', 'applicationId', 'HUMAN_DECISION_REQUIRED: continúa el placeholder');
} else {
  result('READY', 'applicationId', appId);
}

const appName = capacitor.match(/appName:\s*['"]([^'"]+)['"]/)?.[1];
if (!appName || appName === 'front' || strings.includes('>front<')) {
  result('BLOCKED', 'app name', 'HUMAN_DECISION_REQUIRED: falta el nombre comercial definitivo');
} else {
  result('READY', 'app name', appName);
}

const versionCode = appBuild.match(/versionCode\s+(\d+)/)?.[1] ?? 'ausente';
const versionName = appBuild.match(/versionName\s+"([^"]+)"/)?.[1] ?? 'ausente';
result(
  'BLOCKED',
  'release version',
  `HUMAN_DECISION_REQUIRED: confirmar versionCode=${versionCode} y versionName=${versionName}`,
);

if (/signingConfigs\s*\{[\s\S]*?release\s*\{/.test(appBuild)) {
  result('READY', 'release signing', 'hay configuración release; verificar secretos fuera de Git');
} else {
  result('BLOCKED', 'release signing', 'HUMAN_DECISION_REQUIRED: keystore, alias y credenciales seguras');
}

result('BLOCKED', 'branding assets', 'HUMAN_DECISION_REQUIRED: icono y splash definitivos');

console.log('\nRSP-09E native release preflight');
for (const entry of results) {
  console.log(`[${entry.status}] ${entry.item}: ${entry.detail}`);
}

if (results.some((entry) => entry.status === 'BLOCKED')) {
  console.error('\nRelease bloqueada: los contratos técnicos pasaron, pero quedan decisiones humanas.');
  process.exitCode = 2;
}
