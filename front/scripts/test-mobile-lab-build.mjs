// Optional real Angular compilation using an unreachable synthetic backend.
// Does not synchronize Capacitor, create an APK, contact a backend or install anything.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import mobile from './mobile-build-config.cjs';
import { verifyNativeArtifact } from './native-artifact.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'rsp-mobile-lab-build-'));
try {
  const configPath = join(temporary, 'synthetic-only.json');
  const origin = 'https://device-lab.example.invalid';
  await writeFile(configPath, JSON.stringify({ appId: mobile.LAB_ID, backendOrigin: origin, allowedOrigins: [origin] }));
  const env = { ...process.env, RSP_MOBILE_VARIANT: 'lab', NATIVE_LAB_CONFIG: configPath, NATIVE_BACKEND_ORIGIN: origin };
  const child = spawnSync(process.execPath, ['scripts/build-native.mjs', 'lab'], { cwd: root, env, stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Build de laboratorio falló: ${child.status}`);
  await verifyNativeArtifact(join(root, 'dist/mobile-lab/browser'), mobile.mobileSelection(env));
  console.log('MOBILE_LAB_BUILD_VERIFIED — backend sintético inexistente; NO distribuir estos assets');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
