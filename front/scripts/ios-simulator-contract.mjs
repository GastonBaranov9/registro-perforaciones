import { check } from './ios-contract.mjs';
export const XCODE_VERSION = '26.0.1';
export const XCODE_BUILD = '17A400';
export const SIMULATOR_SDK = 'iphonesimulator26.0';
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
}
