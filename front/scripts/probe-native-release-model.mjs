import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGradleReleaseProbe } from './native-gradle-release-probe.mjs';
import { inspectReleaseSigningSource } from './native-release-readiness.mjs';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const androidRoot = join(frontRoot, 'android');
const appBuild = await readFile(join(androidRoot, 'app/build.gradle'), 'utf8');
const signingContract = inspectReleaseSigningSource(appBuild);
const report = await runGradleReleaseProbe({
  projectRoot: androidRoot,
  wrapperRoot: androidRoot,
  signingContract,
});

console.log(JSON.stringify(report, null, 2));
