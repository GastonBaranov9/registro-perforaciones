import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { check, iosPolicy, iosSelection, plist, verifyInfo, verifyIosAssets, verifyIosProject } from './ios-contract.mjs';
import { SIMULATOR_SDK, simulatorArguments, verifySimulatorSettings, verifyApprovedSha, inspectSimulatorToolchain } from './ios-simulator-contract.mjs';

check(process.platform === 'darwin', 'La compilación de simulador requiere macOS/Xcode.');
const front = dirname(dirname(fileURLToPath(import.meta.url)));
const run = (command, args) => execFileSync(command, args, { cwd: front, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const sha = run('git', ['rev-parse', 'HEAD']);
verifyApprovedSha(process.env.IOS_APPROVED_SHA, sha);
check(!run('git', ['diff', 'HEAD', '--name-only']), 'Archivos versionados modificados.');
const selection = iosSelection();
check(selection.variant === 'production', 'Este workflow de simulador solamente admite la identidad productiva autorizada.');
const toolchain = inspectSimulatorToolchain(run, { developerDir: process.env.DEVELOPER_DIR, nodeArch: process.arch });
const { xcode } = toolchain;
console.log('IOS_SIMULATOR_PREFLIGHT_OK ' + JSON.stringify(toolchain));
await verifyIosProject(front, join(front, 'ios'), selection);
const derived = join(front, 'dist/ios-simulator');
const lock = join(front, 'ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved');
let locked = true;
try { await access(lock); } catch (error) { if (error.code === 'ENOENT') locked = false; else throw error; }
const oldLock = locked ? await readFile(lock) : null;
const args = simulatorArguments(derived, locked);
verifySimulatorSettings(JSON.parse(run('xcodebuild', [...args.slice(0, -1), '-showBuildSettings', '-json'])), selection);
execFileSync('xcodebuild', args, { cwd: front, stdio: 'inherit' });
const app = join(derived, 'Build/Products/Debug-iphonesimulator/App.app');
const info = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')]));
verifyInfo(info, selection, await iosPolicy(front), true);
const privacy = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(app, 'PrivacyInfo.xcprivacy')]));
check(isDeepStrictEqual(privacy, plist.parse(await readFile(join(front, 'native/ios/PrivacyInfo.xcprivacy'), 'utf8'))), 'Manifest empaquetado incompatible.');
await verifyIosAssets(front, app, selection);
for (const forbidden of ['embedded.mobileprovision', '_CodeSignature']) {
  let found = false;
  try { await access(join(app, forbidden)); found = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  check(!found, 'Artefacto firmado inesperadamente.');
}
const resolved = await readFile(lock);
check(!oldLock || oldLock.equals(resolved), 'Xcode modificó el lock SPM aprobado.');
const output = join(front, 'dist/ios-evidence');
await mkdir(output, { recursive: true });
await writeFile(join(output, 'Package.resolved'), resolved);
await writeFile(join(output, 'build.json'), JSON.stringify({ sha, xcode, toolchain, capacitor: '8.5.0',
  appId: info.CFBundleIdentifier, deviceFamily: info.UIDeviceFamily, origin: selection.origin,
  websocketOrigin: selection.origin.replace('https:', 'wss:'), sdk: SIMULATOR_SDK,
  signed: false, result: 'IOS_SIMULATOR_BUILD_OK', firstSpmResolution: !locked,
  spmSha256: createHash('sha256').update(resolved).digest('hex'),
}, null, 2) + '\n');
// Reviewable project and simulator bundle only; never an IPA or automatic commit.
run('tar', ['-czf', join(output, 'ios-project-review.tgz'), '--exclude=./App/App/public',
  '--exclude=./App/App/capacitor.config.json', '--exclude=xcuserdata', '--exclude=build', '-C', 'ios', '.']);
run('tar', ['-czf', join(output, 'simulator-app.tgz'), '-C', dirname(app), 'App.app']);
console.log('IOS_SIMULATOR_BUILD_OK (sin ejecución de la app, sin login, sin firma)');
