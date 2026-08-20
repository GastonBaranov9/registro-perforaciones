import { spawnSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createNativeBackendConfig, renderNativeEnvironment } from './native-backend-config.mjs';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const generatedEnvironment = fileURLToPath(
  new URL('../src/environments/environment.native.generated.ts', import.meta.url),
);
const angularCli = fileURLToPath(new URL('../node_modules/@angular/cli/bin/ng.js', import.meta.url));

// Solo este archivo generado puede sobrevivir a una interrupcion abrupta previa.
await rm(generatedEnvironment, { force: true });

let config;
try {
  config = createNativeBackendConfig(process.env.NATIVE_BACKEND_ORIGIN);
} catch (error) {
  console.error(`BUILD_NATIVE_CONFIG_ERROR: ${error.message}`);
  process.exitCode = 2;
}

if (config) {
  try {
    await writeFile(generatedEnvironment, renderNativeEnvironment(config), { encoding: 'utf8', flag: 'wx' });
    const result = spawnSync(
      process.execPath,
      [angularCli, 'build', '--configuration=production,native'],
      { cwd: frontRoot, env: process.env, stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  } finally {
    await rm(generatedEnvironment, { force: true });
  }
}
