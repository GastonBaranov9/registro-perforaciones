import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const dist = join(frontRoot, 'dist', 'front', 'browser');
const angularCli = fileURLToPath(new URL('../node_modules/@angular/cli/bin/ng.js', import.meta.url));

async function artifactText(directory) {
  const contents = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) contents.push(await artifactText(path));
    else if (/\.(?:js|html|json)$/.test(entry.name)) contents.push(await readFile(path, 'utf8'));
  }
  return contents.flat().join('\n');
}

const result = spawnSync(
  process.execPath,
  [angularCli, 'build', '--configuration=production'],
  { cwd: frontRoot, env: process.env, stdio: 'inherit' },
);
if (result.error) throw result.error;
assert.equal(result.status, 0, 'Angular production web build fallo');

const webArtifact = await artifactText(dist);
assert.match(webArtifact, /\/api\//);
assert.match(webArtifact, /\/ws/);
assert.doesNotMatch(webArtifact, /NATIVE_BACKEND_ORIGIN|native-backend\.example/);
assert.doesNotMatch(webArtifact, /capacitor:\/\/localhost/i);

for (const removed of [
  'scripts/build-native.mjs',
  'scripts/native-backend-config.mjs',
  'src/environments/environment.native.generated.ts',
]) {
  await assert.rejects(access(join(frontRoot, removed)), undefined, `${removed} no debe existir`);
}

console.log(JSON.stringify({
  web_backend: 'same-origin',
  web_api: '/api/',
  web_ws: '/ws',
  native_production_build: 'not-supported-until-P2-10',
}));
