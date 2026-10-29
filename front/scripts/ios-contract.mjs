import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import mobile from './mobile-build-config.cjs';
import { verifyNativeArtifact } from './native-artifact.mjs';

// Use the parsers already locked with the official Capacitor CLI.
const requireCli = createRequire(import.meta.resolve('@capacitor/cli/package.json'));
export const plist = requireCli('plist');
const xcode = requireCli('xcode');
export const IOS_ORIGIN = 'https://api.raulsilvaperforaciones.com';
export const IOS_VERSION = '8.5.0';
export const IOS_PLUGINS = {
  '@capacitor/app': ['CapacitorApp', 'AppPlugin'],
  '@capacitor/camera': ['CapacitorCamera', 'CAPCameraPlugin'],
  '@capacitor/filesystem': ['CapacitorFilesystem', 'FilesystemPlugin'],
  '@capacitor/geolocation': ['CapacitorGeolocation', 'GeolocationPlugin'],
  '@capacitor/preferences': ['CapacitorPreferences', 'PreferencesPlugin'],
  '@capacitor/share': ['CapacitorShare', 'SharePlugin'],
  '@aparajita/capacitor-secure-storage': ['AparajitaCapacitorSecureStorage', 'SecureStorage'],
};
export function check(condition, message) { if (!condition) throw new Error(message); }
export function iosSelection(env = process.env) {
  check(['production', 'lab'].includes(env.RSP_MOBILE_VARIANT), 'Seleccionar variante iOS explícita.');
  check(env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'No se permite omitir TLS.');
  const selection = mobile.mobileSelection(env);
  const origin = selection.variant === 'lab' ? selection.origin : IOS_ORIGIN;
  check(env.NATIVE_BACKEND_ORIGIN === origin, 'Backend iOS ausente o no autorizado.');
  return { ...selection, origin };
}
export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export function unquote(value) { return String(value ?? '').replace(/^"|"$/g, ''); }
export async function iosPolicy(front) {
  return {
    permissions: await readJson(join(front, 'native/ios/permissions.json')),
    privacy: plist.parse(await readFile(join(front, 'native/ios/PrivacyInfo.xcprivacy'), 'utf8')),
  };
}
export function verifyInfo(info, selection, policy, built = false) {
  check(info.CFBundleDisplayName === selection.appName, 'Nombre iOS incorrecto.');
  check(info.CFBundleIdentifier === (built ? selection.appId : '$(PRODUCT_BUNDLE_IDENTIFIER)'), 'Bundle ID incorrecto.');
  for (const [key, value] of Object.entries(policy.permissions)) check(info[key] === value, `Permiso incorrecto: ${key}`);
  const requested = Object.keys(info).filter(key => /UsageDescription$/.test(key)).sort();
  check(JSON.stringify(requested) === JSON.stringify(Object.keys(policy.permissions).sort()), 'Permisos adicionales inesperados.');
  check(!info.NSAppTransportSecurity && !info.UIBackgroundModes, 'ATS/background no autorizados.');
  for (const key of ['UISupportedInterfaceOrientations', 'UISupportedInterfaceOrientations~ipad']) {
    check(info[key]?.includes('UIInterfaceOrientationPortrait') &&
      info[key]?.includes('UIInterfaceOrientationLandscapeLeft') &&
      info[key]?.includes('UIInterfaceOrientationLandscapeRight'), 'Orientaciones universales incompletas.');
  }
  if (built) {
    check(JSON.stringify(info.UIDeviceFamily) === '[1,2]', 'El artefacto no es universal.');
    check(info.MinimumOSVersion === '15.0', 'El mínimo iOS del artefacto no corresponde a 15.0.');
  }
}
export function loadProject(ios) {
  const project = xcode.project(join(ios, 'App/App.xcodeproj/project.pbxproj'));
  project.parseSync();
  return project;
}
function appConfigurations(project) {
  const objects = project.hash.project.objects;
  const targets = Object.entries(objects.PBXNativeTarget).filter(([key]) => !key.endsWith('_comment'));
  check(targets.length === 1 && unquote(targets[0][1].name) === 'App', 'Proyecto iOS inesperado.');
  const [id, target] = targets[0];
  const configs = objects.XCConfigurationList[target.buildConfigurationList].buildConfigurations
    .map(ref => objects.XCBuildConfiguration[ref.value].buildSettings);
  check(configs.length === 2, 'Se esperaban Debug y Release oficiales.');
  return { id, target, configs };
}
export function verifyProject(project, selection) {
  const { target, configs } = appConfigurations(project);
  for (const settings of configs) {
    check(unquote(settings.PRODUCT_BUNDLE_IDENTIFIER) === selection.appId, 'Identidad Xcode incompatible.');
    check(unquote(settings.TARGETED_DEVICE_FAMILY) === '1,2', 'Familia iPhone/iPad incorrecta.');
    check(unquote(settings.IPHONEOS_DEPLOYMENT_TARGET) === '15.0', 'Deployment target inesperado.');
    check(!settings.CODE_SIGN_ENTITLEMENTS && !settings.DEVELOPMENT_TEAM && !settings.PROVISIONING_PROFILE_SPECIFIER,
      'Firma/entitlements fuera del alcance de simulador.');
  }
  const objects = project.hash.project.objects;
  const group = objects.PBXGroup[project.findPBXGroupKey({ path: 'App' })];
  const refs = Object.entries(objects.PBXFileReference).filter(([key, ref]) =>
    !key.endsWith('_comment') && unquote(ref.path) === 'PrivacyInfo.xcprivacy');
  check(refs.length === 1 && group?.children.some(ref => ref.value === refs[0][0]), 'Manifest fuera del grupo App.');
  const resources = target.buildPhases.map(ref => objects.PBXResourcesBuildPhase[ref.value]).filter(Boolean);
  const links = resources.flatMap(phase => phase.files).filter(ref => objects.PBXBuildFile[ref.value]?.fileRef === refs[0][0]);
  check(links.length === 1, 'Privacy manifest no incorporado exactamente una vez en Resources.');
}
export async function configureIos(front, ios, selection) {
  const policy = await iosPolicy(front);
  const infoPath = join(ios, 'App/App/Info.plist');
  const info = plist.parse(await readFile(infoPath, 'utf8'));
  info.CFBundleDisplayName = selection.appName;
  info.CFBundleDevelopmentRegion = 'es';
  Object.assign(info, policy.permissions);
  verifyInfo(info, selection, policy);
  const project = loadProject(ios);
  const { id, configs } = appConfigurations(project);
  for (const settings of configs) {
    settings.PRODUCT_BUNDLE_IDENTIFIER = selection.appId;
    settings.TARGETED_DEVICE_FAMILY = '"1,2"';
    settings.IPHONEOS_DEPLOYMENT_TARGET = '15.0';
  }
  // Stable IDs for our resource; no random changes on repeated generation.
  let sequence = 0;
  const nextId = () => {
    const id = createHash('sha256').update(`rsp-ios-privacy-${sequence++}`).digest('hex').slice(0, 24).toUpperCase();
    check(!Object.values(project.hash.project.objects).some(section => section[id]), 'Colisión UUID.');
    return id;
  };
  const group = project.findPBXGroupKey({ path: 'App' });
  check(group, 'Falta grupo App.');
  // The official App group has no separate Resources group. Register the resource
  // directly in the parsed PBX graph (xcode.addResourceFile assumes that group).
  const objects = project.hash.project.objects;
  const resourcePhases = objects.PBXNativeTarget[id].buildPhases
    .map(ref => objects.PBXResourcesBuildPhase[ref.value]).filter(Boolean);
  check(resourcePhases.length === 1, 'Fase Resources ambigua.');
  const existing = Object.entries(objects.PBXFileReference).filter(([key, ref]) =>
    !key.endsWith('_comment') && unquote(ref.path) === 'PrivacyInfo.xcprivacy');
  if (!existing.length) {
    const fileId = nextId(), buildId = nextId();
    objects.PBXFileReference[fileId] = { isa: 'PBXFileReference', lastKnownFileType: 'text.xml',
      path: 'PrivacyInfo.xcprivacy', sourceTree: '"<group>"' };
    objects.PBXFileReference[fileId + '_comment'] = 'PrivacyInfo.xcprivacy';
    objects.PBXBuildFile[buildId] = { isa: 'PBXBuildFile', fileRef: fileId, fileRef_comment: 'PrivacyInfo.xcprivacy' };
    objects.PBXBuildFile[buildId + '_comment'] = 'PrivacyInfo.xcprivacy in Resources';
    objects.PBXGroup[group].children.push({ value: fileId, comment: 'PrivacyInfo.xcprivacy' });
    resourcePhases[0].files.push({ value: buildId, comment: 'PrivacyInfo.xcprivacy in Resources' });
  }
  verifyProject(project, selection);
  const spmPath = join(ios, 'App/CapApp-SPM/Package.swift');
  let spm = await readFile(spmPath, 'utf8');
  const pin = /url: "https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git", (?:from|exact): "8\.5\.0"/g;
  check([...spm.matchAll(pin)].length === 1, 'Versión SPM de Capacitor incompatible.');
  spm = spm.replace(pin, 'url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0"');
  await writeFile(infoPath, plist.build(info) + '\n');
  await writeFile(join(ios, 'App/App/PrivacyInfo.xcprivacy'), await readFile(join(front, 'native/ios/PrivacyInfo.xcprivacy')));
  await writeFile(join(ios, 'App/App.xcodeproj/project.pbxproj'), project.writeSync());
  await writeFile(spmPath, spm);
}
export async function verifyIosWebArtifact(root, selection, config) {
  const artifact = await verifyNativeArtifact(root, selection, config);
  check(artifact.origin === selection.origin && artifact.mode === (selection.variant === 'lab' ? 'lab' : 'production'), 'Origen/modo iOS incorrecto.');
  let originFound = false;
  for (const name of Object.keys(artifact.files).filter(name => /\.(js|html|json)$/.test(name))) {
    const value = await readFile(join(root, name), 'utf8');
    if (name.endsWith('.js') && value.includes(selection.origin)) originFound = true;
    check(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|rspn1_[A-Za-z0-9_-]{43}|AIza[A-Za-z0-9_-]{35}/.test(value), 'Posible secreto en assets.');
  }
  check(originFound, 'Backend no encontrado en JavaScript empaquetado.');
  return artifact;
}
export async function verifyIosAssets(front, app, selection) {
  const config = await readJson(join(app, 'capacitor.config.json'));
  const classes = Object.values(IOS_PLUGINS).map(([, name]) => name).sort();
  check(JSON.stringify([...(config.packageClassList ?? [])].sort()) === JSON.stringify(classes), 'Plugins iOS incompletos o inesperados.');
  check(!config.ios?.allowNavigation && !config.ios?.webContentsDebuggingEnabled, 'Configuración iOS insegura.');
  const source = await verifyIosWebArtifact(join(front, selection.webDir), selection);
  const copied = await verifyIosWebArtifact(join(app, 'public'), selection, config);
  check(JSON.stringify(copied) === JSON.stringify(source), 'Assets iOS no coinciden con Angular.');
  return copied;
}
export async function verifyIosSpm(front, ios) {
  const spm = await readFile(join(ios, 'App/CapApp-SPM/Package.swift'), 'utf8');
  check(spm.includes('.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0")'), 'Capacitor SPM no fijado.');
  for (const [pkg, [product]] of Object.entries(IOS_PLUGINS)) {
    const path = relative(join(ios, 'App/App.xcodeproj'), join(front, 'node_modules', pkg)).replaceAll('\\', '/');
    check(spm.includes(`.product(name: "${product}", package: "${product}")`) &&
      spm.includes(`.package(name: "${product}", path: "${path}")`), `Plugin SPM ausente o ruta incorrecta: ${pkg}`);
    check((await readFile(join(front, 'node_modules', pkg, 'Package.swift'), 'utf8')).includes(product), 'Plugin sin soporte SPM.');
  }
}
export async function verifyIosProject(front, ios, selection) {
  const policy = await iosPolicy(front);
  verifyInfo(plist.parse(await readFile(join(ios, 'App/App/Info.plist'), 'utf8')), selection, policy);
  verifyProject(loadProject(ios), selection);
  check((await readFile(join(ios, 'App/App/PrivacyInfo.xcprivacy'))).equals(await readFile(join(front, 'native/ios/PrivacyInfo.xcprivacy'))), 'Privacy manifest alterado.');
  await verifyIosSpm(front, ios);
  check(!(await readdir(join(ios, 'App/App'))).some(name => name.endsWith('.entitlements')), 'Entitlements no autorizados.');
  return verifyIosAssets(front, join(ios, 'App/App'), selection);
}
