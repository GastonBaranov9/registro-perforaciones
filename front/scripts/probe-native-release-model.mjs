import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGradleReleaseProbe } from './native-gradle-release-probe.mjs';
import { inspectReleaseSigningSource } from './native-release-readiness.mjs';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const appBuild = await readFile(join(frontRoot, 'android/app/build.gradle'), 'utf8');
const signingContract = inspectReleaseSigningSource(appBuild);
const report = await runGradleReleaseProbe({ frontRoot, signingContract });

console.log(JSON.stringify(report, null, 2));
