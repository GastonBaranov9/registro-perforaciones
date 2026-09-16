import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateNativeReleaseReadiness,
  loadNativeReleaseInputs,
} from './native-release-readiness.mjs';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const tests = (await readdir(join(frontRoot, 'scripts')))
  .filter((name) => /^native-.*\.test\.mjs$/.test(name))
  .map((name) => join('scripts', name));
tests.push(join('scripts', 'production-contract.test.mjs'));
const testResult = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: frontRoot,
  env: process.env,
  stdio: 'inherit',
});
if (testResult.error) throw testResult.error;
if (testResult.status !== 0) process.exit(testResult.status ?? 1);

const readiness = evaluateNativeReleaseReadiness(
  await loadNativeReleaseInputs(frontRoot, process.env.NATIVE_BACKEND_ORIGIN),
);

console.log('\nRSP-09E native release preflight');
for (const entry of readiness.entries) {
  console.log(`[${entry.status}] ${entry.item}: ${entry.detail}`);
}

if (readiness.blocked) {
  console.error('\nRelease bloqueada por el estado técnico o por decisiones aún reflejadas como placeholders.');
} else {
  console.log('\nRelease readiness: READY. Completar los MANUAL_CHECK antes de firmar o publicar.');
}
process.exitCode = readiness.exitCode;
