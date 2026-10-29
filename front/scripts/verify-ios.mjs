import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { check, iosSelection, verifyIosProject, verifyIosWebArtifact } from './ios-contract.mjs';
const front = dirname(dirname(fileURLToPath(import.meta.url)));
const selection = iosSelection();
check(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--web-only'), 'Argumento no admitido.');
if (process.argv[2] === '--web-only') {
  await verifyIosWebArtifact(join(front, selection.webDir), selection);
  console.log('IOS_WEB_ASSETS_VERIFIED (no verifica un proyecto Xcode ni un binario)');
} else {
  await verifyIosProject(front, join(front, 'ios'), selection);
  console.log('IOS_PROJECT_VERIFIED');
}
