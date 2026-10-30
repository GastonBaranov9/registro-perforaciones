import { check } from './ios-contract.mjs';
export const XCODE_VERSION = '26.2';
export const XCODE_BUILD = '17C52';
export const SIMULATOR_SDK = 'iphonesimulator26.2';
export const DEVELOPER_DIR = '/Applications/Xcode_26.2.app/Contents/Developer';
const RUNTIME_ID = 'com.apple.CoreSimulator.SimRuntime.iOS-26-2';

export function verifyApprovedSha(approved, actual) {
  check(/^[0-9a-f]{40}$/.test(approved ?? '') && approved === actual, 'SHA fuente no aprobado.');
}

// Read-only probes, under the same DEVELOPER_DIR as the subsequent build.
// Fail closed: no downloads, boot, fallback Xcode or automatic retry.
export function inspectSimulatorToolchain(run, { developerDir, nodeArch }) {
  check(developerDir === DEVELOPER_DIR, 'DEVELOPER_DIR distinto del Xcode aprobado.');
  const xcode = run('xcodebuild', ['-version']);
  check(xcode === `Xcode ${XCODE_VERSION}\nBuild version ${XCODE_BUILD}`, 'Xcode distinto del evaluado.');
  const sdks = run('xcodebuild', ['-showsdks']).split(/\s+/);
  check(sdks.some((value, i) => value === '-sdk' && sdks[i + 1] === SIMULATOR_SDK), 'SDK de simulador ausente o incorrecto.');
  const sdkVersion = run('xcrun', ['--sdk', SIMULATOR_SDK, '--show-sdk-version']);
  const sdkPath = run('xcrun', ['--sdk', SIMULATOR_SDK, '--show-sdk-path']);
  check(sdkVersion === '26.2' && sdkPath === `${DEVELOPER_DIR}/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator26.2.sdk`,
    'SDK efectivo incompatible o mezcla de instalaciones Xcode.');
  const hostArch = run('uname', ['-m']);
  // This combination is validated against the observed macos-26-arm64 image.
  check(hostArch === 'arm64' && nodeArch === 'arm64', 'Arquitectura no evaluada: se requiere runner y Node arm64 nativos.');
  let inventory;
  try { inventory = JSON.parse(run('xcrun', ['simctl', 'list', 'runtimes', '-j'])); }
  catch { throw new Error('No se pudo obtener JSON válido de runtimes mediante simctl.'); }
  check(Array.isArray(inventory?.runtimes), 'Inventario de runtimes inválido.');
  const matches = inventory.runtimes.filter(runtime => runtime?.identifier === RUNTIME_ID);
  check(matches.length === 1, 'Runtime iOS Simulator 26.2 ausente o ambiguo; build bloqueado.');
  const runtime = matches[0];
  check(/^26\.2(?:\.0)?$/.test(runtime.version ?? '') && runtime.name === 'iOS 26.2', 'Runtime contradictorio con SDK 26.2.');
  check(runtime.isAvailable === true && !runtime.availabilityError, 'Runtime iOS Simulator 26.2 no disponible; build bloqueado.');
  check(typeof runtime.buildversion === 'string' && runtime.buildversion.length > 0, 'Runtime sin identidad de build.');
  return { xcode, sdk: SIMULATOR_SDK, sdkVersion, sdkPath, hostArch,
    runtime: { identifier: runtime.identifier, version: runtime.version, build: runtime.buildversion, available: true } };
}
export function simulatorArguments(derivedData, locked = false) {
  return ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug',
    '-sdk', SIMULATOR_SDK, '-destination', 'generic/platform=iOS Simulator',
    '-derivedDataPath', derivedData, ...(locked ? ['-onlyUsePackageVersionsFromResolvedFile'] : []),
    'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=',
    'DEVELOPMENT_TEAM=', 'build'];
}
export function verifySimulatorSettings(settings, selection) {
  const apps = settings.filter(item => item.target === 'App');
  check(apps.length === 1, 'Build settings ambiguos.');
  const s = apps[0].buildSettings;
  check(s.PRODUCT_BUNDLE_IDENTIFIER === selection.appId && s.TARGETED_DEVICE_FAMILY === '1,2', 'Identidad/familia efectiva incorrecta.');
  check(s.CODE_SIGNING_ALLOWED === 'NO' && s.CODE_SIGNING_REQUIRED === 'NO' &&
    !s.CODE_SIGN_IDENTITY && !s.DEVELOPMENT_TEAM && !s.CODE_SIGN_ENTITLEMENTS &&
    !s.PROVISIONING_PROFILE_SPECIFIER, 'Firma habilitada inesperadamente.');
  check(s.PLATFORM_NAME === 'iphonesimulator' && s.SDK_NAME === SIMULATOR_SDK, 'SDK efectivo incorrecto.');
  check(s.IPHONEOS_DEPLOYMENT_TARGET === '15.0', 'El mínimo iOS efectivo no corresponde a 15.0.');
  check(typeof s.ARCHS === 'string' && s.ARCHS.split(/\s+/).includes('arm64') &&
    !(s.EXCLUDED_ARCHS ?? '').split(/\s+/).includes('arm64'), 'Arquitectura efectiva no compatible con el runner arm64.');
}
