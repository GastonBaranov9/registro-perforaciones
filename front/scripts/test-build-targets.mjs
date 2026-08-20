import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const dist = join(frontRoot, 'dist', 'front', 'browser');
const buildNative = fileURLToPath(new URL('./build-native.mjs', import.meta.url));
const angularCli = fileURLToPath(new URL('../node_modules/@angular/cli/bin/ng.js', import.meta.url));
const generatedEnvironment = join(frontRoot, 'src', 'environments', 'environment.native.generated.ts');
const fixtureOrigin = 'https://native-backend.example';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: frontRoot, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} fallo`);
}

async function artifactText(directory) {
  const contents = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) contents.push(await artifactText(path));
    else if (/\.(?:js|html|json)$/.test(entry.name)) contents.push(await readFile(path, 'utf8'));
  }
  return contents.flat().join('\n');
}

const missingEnvironment = { ...process.env };
delete missingEnvironment.NATIVE_BACKEND_ORIGIN;
const missingResult = spawnSync(process.execPath, [buildNative], {
  cwd: frontRoot,
  env: missingEnvironment,
  encoding: 'utf8',
});
assert.equal(missingResult.status, 2);
assert.match(missingResult.stderr, /BUILD_NATIVE_CONFIG_ERROR: Falta NATIVE_BACKEND_ORIGIN/);
await assert.rejects(access(generatedEnvironment));

run(process.execPath, [buildNative], { ...process.env, NATIVE_BACKEND_ORIGIN: fixtureOrigin });
await assert.rejects(access(generatedEnvironment));
const nativeArtifact = await artifactText(dist);
assert.match(nativeArtifact, /https:\/\/native-backend\.example\/api\//);
assert.match(nativeArtifact, /wss:\/\/native-backend\.example\/ws/);
assert.doesNotMatch(nativeArtifact, /(?:https?|wss?):\/\/(?:[^/]*\.)?localhost(?=[:/]|$)/i);
assert.doesNotMatch(nativeArtifact, /capacitor:\/\/localhost/i);

run(process.execPath, [angularCli, 'build', '--configuration=production']);
const webArtifact = await artifactText(dist);
assert.doesNotMatch(webArtifact, /native-backend\.example/);
assert.match(webArtifact, /\/api\//);
assert.match(webArtifact, /\/ws/);

console.log(JSON.stringify({
  native_backend_routing: 'prepared',
  native_api: `${fixtureOrigin}/api/`,
  native_ws: 'wss://native-backend.example/ws',
  web_backend: 'same-origin',
  android_authentication: 'pending-P2-10',
}));
