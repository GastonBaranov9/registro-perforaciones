import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { check, configureIos, iosSelection, readJson, verifyIosProject } from './ios-contract.mjs';
import { verifyNativeArtifact } from './native-artifact.mjs';

// Never manufacture a native project on Windows. Use the official CLI on macOS.
check(process.platform === 'darwin', 'La generación real de iOS requiere macOS/Xcode.');
const front = dirname(dirname(fileURLToPath(import.meta.url)));
const selection = iosSelection();
for (const pkg of ['core', 'cli', 'ios']) {
  check((await readJson(join(front, `node_modules/@capacitor/${pkg}/package.json`))).version === '8.5.0', 'Capacitor desalineado.');
}
const artifact = await verifyNativeArtifact(join(front, selection.webDir), selection);
check(artifact.origin === selection.origin && artifact.mode === (selection.variant === 'lab' ? 'lab' : 'production'), 'Build nativo incorrecto.');
const ios = join(front, 'ios');
let exists = true;
try { await access(ios); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
const cap = (...args) => execFileSync(process.execPath, [join(front, 'node_modules/@capacitor/cli/bin/capacitor'), ...args], { cwd: front, stdio: 'inherit' });
if (!exists) cap('add', 'ios', '--packagemanager', 'SPM');
else await access(join(ios, 'App/CapApp-SPM/Package.swift')); // Refuse CocoaPods or incomplete projects.
cap('sync', 'ios');
await configureIos(front, ios, selection);
await verifyIosProject(front, ios, selection);
console.log('IOS_PREPARED: proyecto oficial SPM, permisos y assets verificados.');
