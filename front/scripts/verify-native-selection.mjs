import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import mobile from './mobile-build-config.cjs';
import { verifyNativeArtifact } from './native-artifact.mjs';

const selection = mobile.mobileSelection();
const [variant, assets, config] = process.argv.slice(2);
if (!assets || !config || variant !== selection.variant) throw new Error('Selección Gradle/Capacitor no coincide.');
await verifyNativeArtifact(resolve(assets), selection, JSON.parse(await readFile(resolve(config), 'utf8')));
console.log('NATIVE_ARTIFACT_ISOLATION_OK');
