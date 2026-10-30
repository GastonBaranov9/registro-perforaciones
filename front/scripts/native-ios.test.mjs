import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { IOS_ORIGIN, IOS_PLUGINS, iosSelection, iosPolicy, plist, configureIos,
  loadProject, verifyProject, verifyInfo, verifyIosAssets, verifyIosSpm, readJson } from './ios-contract.mjs';
import { recordNativeArtifact, nativeCsp } from './native-artifact.mjs';
import { simulatorArguments, verifySimulatorSettings, SIMULATOR_SDK, DEVELOPER_DIR,
  inspectSimulatorToolchain, verifyApprovedSha } from './ios-simulator-contract.mjs';

const front = dirname(dirname(fileURLToPath(import.meta.url)));
const env = { RSP_MOBILE_VARIANT: 'production', NATIVE_BACKEND_ORIGIN: IOS_ORIGIN };
const selection = iosSelection(env);
const requireCli = createRequire(import.meta.resolve('@capacitor/cli/package.json'));

const versionedIos = join(front, 'ios');
const resolvedPath = 'App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved';

test('proyecto recuperado del build: identidad, privacidad, permisos y siete plugins coherentes', async () => {
  verifyProject(loadProject(versionedIos), selection);
  verifyInfo(plist.parse(await readFile(join(versionedIos, 'App/App/Info.plist'), 'utf8')), selection, await iosPolicy(front));
  assert.deepEqual(await readFile(join(versionedIos, 'App/App/PrivacyInfo.xcprivacy')),
    await readFile(join(front, 'native/ios/PrivacyInfo.xcprivacy')));
  await verifyIosSpm(front, versionedIos);
});

test('lock recuperado: cuatro repositorios, versiones y revisiones del build aprobado', async () => {
  const bytes = await readFile(join(versionedIos, resolvedPath));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '56a364979903d2990a2eaad3fb86781113e286e27d4c7d63a7945dc9722ae9df');
  const lock = JSON.parse(bytes);
  assert.equal(lock.version, 3);
  assert.match(lock.originHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(lock.pins.map(pin => [pin.identity, pin.kind, pin.location, pin.state]), [
    ['capacitor-swift-pm', 'remoteSourceControl', 'https://github.com/ionic-team/capacitor-swift-pm.git',
      { revision: '4f71d0b979f2f957326f04353eca7604ee937e1e', version: '8.5.0' }],
    ['ion-ios-filesystem', 'remoteSourceControl', 'https://github.com/ionic-team/ion-ios-filesystem.git',
      { revision: '56bd6f9e77cb4f2269c03f2d92a9fe58fe168a1c', version: '1.1.4' }],
    ['ion-ios-geolocation', 'remoteSourceControl', 'https://github.com/ionic-team/ion-ios-geolocation.git',
      { revision: 'db363927d3a954e3ea24d2e72b6e9814769a84be', version: '2.1.1' }],
    ['keychain-swift', 'remoteSourceControl', 'https://github.com/evgenyneu/keychain-swift.git',
      { revision: '265806607b45687a3d646e4c9837c31c90f202e8', version: '21.0.0' }],
  ]);
});

test('configurador sobre copia del proyecto compilado conserva bytes y lock', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rsp-ios-imported-project-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ios = join(root, 'ios');
  await cp(versionedIos, ios, { recursive: true });
  const files = ['App/App/Info.plist', 'App/App/PrivacyInfo.xcprivacy', 'App/App.xcodeproj/project.pbxproj',
    'App/CapApp-SPM/Package.swift', resolvedPath];
  const before = await Promise.all(files.map(file => readFile(join(ios, file))));
  await configureIos(front, ios, selection);
  for (let index = 0; index < files.length; index++) assert.deepEqual(await readFile(join(ios, files[index])), before[index], files[index]);
});

test('generador SPM oficial reproduce el Package.swift importado sin rutas del runner', async () => {
  const { generatePackageText } = requireCli('./dist/util/spm.js');
  const config = { app: { rootDir: front, extConfig: {} }, ios: { name: 'ios', nativeXcodeProjDirAbs: join(versionedIos, 'App/App.xcodeproj') } };
  const plugins = Object.entries(IOS_PLUGINS).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, [name]]) => ({ id, name, rootPath: join(front, 'node_modules', id), ios: { name, type: 0 } }));
  const generated = (await generatePackageText(config, plugins)).replaceAll('\\', '/');
  assert.equal(generated, await readFile(join(versionedIos, 'App/CapApp-SPM/Package.swift'), 'utf8'));
});

test('Git conserva lock y fuentes; ignora assets generados, caches y material de firma', () => {
  const native = path => 'ios/' + path;
  for (const path of [resolvedPath, 'App/App.xcodeproj/project.pbxproj', 'App/App/AppDelegate.swift']) {
    const result = spawnSync('git', ['check-ignore', '--no-index', '-q', native(path)], { cwd: front });
    assert.equal(result.status, 1, path);
  }
  for (const path of ['App/App/public/index.html', 'App/App/capacitor.config.json', 'App/App/config.xml',
    'App/build/App.app/App', 'DerivedData/cache', 'App/App.xcodeproj/xcuserdata/user.xcuserdatad',
    'App/CapApp-SPM/.build/cache', 'App/CapApp-SPM/Packages/cache', 'capacitor-cordova-ios-plugins/generated',
    'private.p12', 'private.p8', 'profile.mobileprovision']) {
    const result = spawnSync('git', ['check-ignore', '--no-index', '-q', native(path)], { cwd: front });
    assert.equal(result.status, 0, path);
  }
  const attributes = spawnSync('git', ['check-attr', 'eol', '--', native(resolvedPath)], { cwd: front, encoding: 'utf8' });
  assert.equal(attributes.status, 0);
  assert.match(attributes.stdout, /: eol: lf\s*$/);
});

test('identidad y backend iOS productivos explícitos', () => {
  assert.equal(selection.appId, 'uy.com.raulsilva.perforaciones');
  assert.equal(selection.appName, 'Raul Silva Perforaciones');
  assert.equal(selection.origin, IOS_ORIGIN);
});
for (const [name, change] of Object.entries({
  varianteAusente: { RSP_MOBILE_VARIANT: undefined }, varianteDesconocida: { RSP_MOBILE_VARIANT: 'ios' },
  backendAusente: { NATIVE_BACKEND_ORIGIN: undefined }, backendHttp: { NATIVE_BACKEND_ORIGIN: IOS_ORIGIN.replace('https:', 'http:') },
  backendAjeno: { NATIVE_BACKEND_ORIGIN: 'https://example.invalid' }, backendWeb: { NATIVE_BACKEND_ORIGIN: 'https://app.raulsilvaperforaciones.com' },
  backendRuta: { NATIVE_BACKEND_ORIGIN: IOS_ORIGIN + '/' }, tlsDesactivado: { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  identidadMezclada: { NATIVE_APP_ID: 'otra.identidad' }, laboratorioMezclado: { NATIVE_LAB_CONFIG: '/private/lab.json' },
})) test(`rechaza ${name}`, () => assert.throws(() => iosSelection({ ...env, ...change })));

test('selector de laboratorio conserva identidad separada y allowlist', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rsp-ios-lab-contract-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'lab.json');
  await writeFile(file, JSON.stringify({ appId: 'uy.com.raulsilva.perforaciones.pruebas',
    backendOrigin: 'https://lab.example.invalid', allowedOrigins: ['https://lab.example.invalid'] }));
  const lab = iosSelection({ RSP_MOBILE_VARIANT: 'lab', NATIVE_BACKEND_ORIGIN: 'https://lab.example.invalid', NATIVE_LAB_CONFIG: file });
  assert.equal(lab.appId, selection.appId + '.pruebas');
  assert.throws(() => iosSelection({ RSP_MOBILE_VARIANT: 'lab', NATIVE_BACKEND_ORIGIN: IOS_ORIGIN, NATIVE_LAB_CONFIG: file }));
});

test('plataformas alineadas y siete plugins con SPM y clases reales', async () => {
  const { getPluginFiles, findPluginClasses } = requireCli('./dist/util/iosplugin.js');
  for (const pkg of ['core', 'cli', 'ios', 'android']) assert.equal((await readJson(join(front, `node_modules/@capacitor/${pkg}/package.json`))).version, '8.5.0');
  for (const [pkg, [product, nativeClass]] of Object.entries(IOS_PLUGINS)) {
    const rootPath = join(front, 'node_modules', pkg);
    const spm = await readFile(join(rootPath, 'Package.swift'), 'utf8');
    assert.ok(spm.includes(`name: "${product}"`));
    const files = await getPluginFiles([{ rootPath, ios: { path: 'ios', type: 0 } }]);
    assert.ok((await findPluginClasses(files)).includes(nativeClass), pkg);
  }
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'rsp-ios-official-template-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ios = join(root, 'ios');
  await mkdir(ios);
  await requireCli('tar').x({ file: join(front, 'node_modules/@capacitor/cli/assets/ios-spm-template.tar.gz'), cwd: ios });
  // Official CLI generator against a temporary template: not a native build.
  const spmPath = join(ios, 'App/CapApp-SPM/Package.swift');
  const { generatePackageText } = requireCli('./dist/util/spm.js');
  const config = { app: { rootDir: front, extConfig: {} }, ios: { name: 'ios', nativeXcodeProjDirAbs: join(ios, 'App/App.xcodeproj') } };
  const plugins = Object.entries(IOS_PLUGINS).map(([id, [name]]) => ({ id, name, rootPath: join(front, 'node_modules', id), ios: { name, type: 0 } }));
  await writeFile(spmPath, (await generatePackageText(config, plugins)).replaceAll('\\', '/'));
  await configureIos(front, ios, selection);
  return { root, ios };
}

test('plantilla oficial: configuración idempotente, universal y recurso de privacidad incluido', async t => {
  const { ios } = await fixture(t);
  const files = ['App/App/Info.plist', 'App/App/PrivacyInfo.xcprivacy', 'App/App.xcodeproj/project.pbxproj', 'App/CapApp-SPM/Package.swift'];
  const before = await Promise.all(files.map(file => readFile(join(ios, file))));
  await configureIos(front, ios, selection);
  for (let index = 0; index < files.length; index++) assert.deepEqual(await readFile(join(ios, files[index])), before[index]);
  verifyProject(loadProject(ios), selection);
  await verifyIosSpm(front, ios);
  const info = plist.parse(await readFile(join(ios, files[0]), 'utf8'));
  verifyInfo(info, selection, await iosPolicy(front));
  assert.equal(info.NSPhotoLibraryAddUsageDescription, undefined);
  assert.equal(info.UIBackgroundModes, undefined);
});

for (const [name, mutate] of Object.entries({
  identidad: p => { for (const c of Object.values(p.hash.project.objects.XCBuildConfiguration)) if (c.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER) c.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = 'incorrecta'; },
  soloIphone: p => { for (const c of Object.values(p.hash.project.objects.XCBuildConfiguration)) if (c.buildSettings?.TARGETED_DEVICE_FAMILY) c.buildSettings.TARGETED_DEVICE_FAMILY = '1'; },
  keychainCompartido: p => { for (const c of Object.values(p.hash.project.objects.XCBuildConfiguration)) if (c.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER) c.buildSettings.CODE_SIGN_ENTITLEMENTS = 'sharing.entitlements'; },
  privacySinRecurso: p => { for (const r of Object.values(p.hash.project.objects.PBXResourcesBuildPhase)) if (r.files) r.files = []; },
})) test(`proyecto rechaza ${name}`, async t => {
  const { ios } = await fixture(t); const p = loadProject(ios); mutate(p);
  assert.throws(() => verifyProject(p, selection));
});

for (const [name, change] of Object.entries({
  ats: { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } },
  background: { UIBackgroundModes: ['location'] }, permisoInesperado: { NSMicrophoneUsageDescription: 'No corresponde' },
  permisoVacio: { NSCameraUsageDescription: '' }, nombre: { CFBundleDisplayName: 'Otro' },
})) test(`Info.plist rechaza ${name}`, async t => {
  const { ios } = await fixture(t);
  const info = plist.parse(await readFile(join(ios, 'App/App/Info.plist'), 'utf8'));
  const policy = await iosPolicy(front);
  assert.throws(() => verifyInfo({ ...info, ...change }, selection, policy));
});

test('privacy: razones específicas, sin tracking ni declaración ficticia de datos no recogidos', async () => {
  const { privacy } = await iosPolicy(front);
  assert.equal(privacy.NSPrivacyTracking, false);
  assert.deepEqual(privacy.NSPrivacyTrackingDomains, []);
  assert.deepEqual(privacy.NSPrivacyAccessedAPITypes, [
    { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
    { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
  ]);
  assert.equal(privacy.NSPrivacyCollectedDataTypes, undefined); // Distribution disclosure still needs review.
});

test('Info.plist del artefacto exige identidad resuelta y ambas familias', async t => {
  const { ios } = await fixture(t);
  const policy = await iosPolicy(front);
  const info = { ...plist.parse(await readFile(join(ios, 'App/App/Info.plist'), 'utf8')),
    CFBundleIdentifier: selection.appId, UIDeviceFamily: [1, 2], MinimumOSVersion: '15.0' };
  verifyInfo(info, selection, policy, true);
  assert.throws(() => verifyInfo({ ...info, UIDeviceFamily: [1] }, selection, policy, true));
  assert.throws(() => verifyInfo({ ...info, CFBundleIdentifier: selection.appId + '.pruebas' }, selection, policy, true));
});
test('mínimo iOS del artefacto rechaza versiones distintas o ausentes', async t => {
  const { ios } = await fixture(t);
  const policy = await iosPolicy(front);
  const info = { ...plist.parse(await readFile(join(ios, 'App/App/Info.plist'), 'utf8')),
    CFBundleIdentifier: selection.appId, UIDeviceFamily: [1, 2], MinimumOSVersion: '15.0' };
  verifyInfo(info, selection, policy, true);
  for (const minimum of ['14.0', '16.0', undefined]) {
    assert.throws(() => verifyInfo({ ...info, MinimumOSVersion: minimum }, selection, policy, true), /mínimo iOS/);
  }
});
for (const [name, from, to] of [
  ['versión no fijada', 'exact: "8.5.0"', 'from: "8.5.0"'],
  ['plugin no enlazado', '.product(name: "CapacitorCamera", package: "CapacitorCamera")', ''],
  ['ruta externa al paquete', 'node_modules/@capacitor/camera', 'otro-paquete/camera'],
]) test(`SPM rechaza ${name}`, async t => {
  const { ios } = await fixture(t);
  const path = join(ios, 'App/CapApp-SPM/Package.swift');
  await writeFile(path, (await readFile(path, 'utf8')).replace(from, to));
  await assert.rejects(() => verifyIosSpm(front, ios));
});

async function assets(t) {
  const { root, ios } = await fixture(t);
  const source = join(root, selection.webDir), app = join(ios, 'App/App');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'index.html'), `<meta http-equiv="Content-Security-Policy" content="${nativeCsp(IOS_ORIGIN)}">`);
  await writeFile(join(source, 'main.js'), `const api = "${IOS_ORIGIN}";`);
  await recordNativeArtifact(source, selection, 'production', IOS_ORIGIN);
  await cp(source, join(app, 'public'), { recursive: true });
  await writeFile(join(app, 'capacitor.config.json'), JSON.stringify({ appId: selection.appId, appName: selection.appName,
    packageClassList: Object.values(IOS_PLUGINS).map(([, name]) => name) }));
  return { root, ios, source, app };
}
test('assets iOS copiados conservan hashes, origen y WSS', async t => {
  const { root, app } = await assets(t);
  const manifest = await verifyIosAssets(root, app, selection);
  assert.equal(manifest.websocketOrigin, 'wss://api.raulsilvaperforaciones.com');
});
test('rechaza un patrón de clave privada incluso con hashes consistentes', async t => {
  const f = await assets(t);
  await writeFile(join(f.source, 'main.js'), `const api = "${IOS_ORIGIN}"; /* -----BEGIN PRIVATE KEY----- */`);
  await recordNativeArtifact(f.source, selection, 'production', IOS_ORIGIN);
  await cp(f.source, join(f.app, 'public'), { recursive: true });
  await assert.rejects(() => verifyIosAssets(f.root, f.app, selection), /Posible secreto/);
});
test('rechaza build development con el mismo origen productivo', async t => {
  const f = await assets(t);
  await recordNativeArtifact(f.source, selection, 'development', IOS_ORIGIN);
  await cp(f.source, join(f.app, 'public'), { recursive: true });
  await assert.rejects(() => verifyIosAssets(f.root, f.app, selection), /Origen\/modo/);
});
for (const [name, mutate] of Object.entries({
  contenido: async f => writeFile(join(f.app, 'public/main.js'), 'alterado'),
  csp: async f => writeFile(join(f.app, 'public/index.html'), '<meta http-equiv="Content-Security-Policy" content="connect-src *">'),
  plugin: async f => { const file = join(f.app, 'capacitor.config.json'); const config = await readJson(file); config.packageClassList.pop(); await writeFile(file, JSON.stringify(config)); },
  servidor: async f => { const file = join(f.app, 'capacitor.config.json'); const config = await readJson(file); config.server = { url: IOS_ORIGIN }; await writeFile(file, JSON.stringify(config)); },
  origen: async f => { const file = join(f.app, 'public/rsp-native-build.json'); const manifest = await readJson(file); manifest.origin = 'https://other.example.invalid'; await writeFile(file, JSON.stringify(manifest)); },
})) test(`assets rechazan ${name}`, async t => { const f = await assets(t); await mutate(f); await assert.rejects(() => verifyIosAssets(f.root, f.app, selection)); });

test('comando de simulador prohíbe firma y respeta lockfile disponible', () => {
  const args = simulatorArguments('/tmp/derived', true);
  assert.ok(args.includes('CODE_SIGNING_ALLOWED=NO'));
  assert.ok(args.includes('-onlyUsePackageVersionsFromResolvedFile'));
  assert.ok(args.includes('generic/platform=iOS Simulator'));
  assert.ok(!args.some(value => /archive|exportArchive|allowProvisioning/.test(value)));
  const settings = [{ target: 'App', buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: selection.appId, TARGETED_DEVICE_FAMILY: '1,2',
    CODE_SIGNING_ALLOWED: 'NO', CODE_SIGNING_REQUIRED: 'NO', CODE_SIGN_IDENTITY: '', DEVELOPMENT_TEAM: '',
    IPHONEOS_DEPLOYMENT_TARGET: '15.0', ARCHS: 'arm64 x86_64', PLATFORM_NAME: 'iphonesimulator', SDK_NAME: SIMULATOR_SDK } }];
  verifySimulatorSettings(settings, selection);
  settings[0].buildSettings.CODE_SIGNING_ALLOWED = 'YES';
  assert.throws(() => verifySimulatorSettings(settings, selection));
});
test('mínimo iOS efectivo rechaza overrides de compilación', () => {
  const s = { PRODUCT_BUNDLE_IDENTIFIER: selection.appId, TARGETED_DEVICE_FAMILY: '1,2',
    CODE_SIGNING_ALLOWED: 'NO', CODE_SIGNING_REQUIRED: 'NO', CODE_SIGN_IDENTITY: '', DEVELOPMENT_TEAM: '',
    IPHONEOS_DEPLOYMENT_TARGET: '15.0', ARCHS: 'arm64 x86_64', PLATFORM_NAME: 'iphonesimulator', SDK_NAME: SIMULATOR_SDK };
  verifySimulatorSettings([{ target: 'App', buildSettings: s }], selection);
  for (const minimum of ['14.0', '16.0', undefined]) {
    assert.throws(() => verifySimulatorSettings([{ target: 'App', buildSettings: { ...s, IPHONEOS_DEPLOYMENT_TARGET: minimum } }], selection), /mínimo iOS/);
  }
});

test('workflow estático: exclusivamente manual, SHA exacto, mínimo permiso y sin firma/secretos', async () => {
  // JSON is a YAML subset: no implicit YAML boolean conversions of the "on" key.
  const workflow = await readJson(join(front, '../.github/workflows/ios-simulator.yml'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const job = workflow.jobs.simulator;
  assert.equal(job['runs-on'], 'macos-26');
  assert.equal(job.env.DEVELOPER_DIR, '/Applications/Xcode_26.2.app/Contents/Developer');
  assert.equal(job.env.NATIVE_BACKEND_ORIGIN, IOS_ORIGIN);
  assert.equal(job.env.RSP_MOBILE_VARIANT, 'production');
  assert.ok(job.steps[0].run.includes('"$IOS_APPROVED_SHA" == "$WORKFLOW_SHA"'));
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ inputs.approved_sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  for (const step of job.steps.filter(step => step.uses)) assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|pull_request|assemble|docker|TestFlight|app-store/);
  const commands = job.steps.map(step => step.run ?? '').join('\n');
  for (const expected of ['npm ci', 'build:native:production', 'prepare:ios', 'build:ios:simulator']) assert.ok(commands.includes(expected));
});

function toolchainFixture() {
  const runtime = { identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-2', name: 'iOS 26.2',
    version: '26.2', buildversion: '23C54', isAvailable: true };
  const replies = {
    'xcodebuild -version': 'Xcode 26.2\nBuild version 17C52',
    'xcodebuild -showsdks': 'Simulator - iOS 26.2\t-sdk iphonesimulator26.2\n',
    'xcrun --sdk iphonesimulator26.2 --show-sdk-version': '26.2',
    'xcrun --sdk iphonesimulator26.2 --show-sdk-path': `${DEVELOPER_DIR}/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator26.2.sdk`,
    'uname -m': 'arm64',
    'xcrun simctl list runtimes -j': JSON.stringify({ runtimes: [runtime] }),
  };
  const calls = [];
  const run = (command, args) => {
    const key = [command, ...args].join(' '); calls.push(key);
    assert.ok(Object.hasOwn(replies, key), `Operación inesperada: ${key}`);
    return replies[key];
  };
  return { runtime, replies, run, calls, options: { developerDir: DEVELOPER_DIR, nodeArch: 'arm64' } };
}

test('preflight acepta solamente la combinación evaluada y usa sondas de lectura', () => {
  const f = toolchainFixture(); const evidence = inspectSimulatorToolchain(f.run, f.options);
  assert.equal(evidence.sdk, 'iphonesimulator26.2'); assert.equal(evidence.runtime.build, '23C54');
  assert.equal(evidence.hostArch, 'arm64'); assert.equal(f.calls.length, 6);
  assert.ok(f.calls.includes('xcrun simctl list runtimes -j'));
  assert.ok(!f.calls.some(c => / boot |download|install| build$/.test(c)));
});
for (const [name, runtimes, message] of [
  ['runtime ausente', () => [], /ausente/],
  ['solo runtime posterior', r => [{ ...r, identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-4', version: '26.4' }], /ausente/],
  ['runtime no disponible', r => [{ ...r, isAvailable: false }], /no disponible/],
  ['disponibilidad ausente', r => [{ ...r, isAvailable: undefined }], /no disponible/],
  ['disponibilidad textual', r => [{ ...r, isAvailable: 'true' }], /no disponible/],
  ['error de disponibilidad', r => [{ ...r, availabilityError: 'Unsupported host' }], /no disponible/],
  ['version contradictoria', r => [{ ...r, version: '26.0' }], /contradictorio/],
  ['nombre contradictorio', r => [{ ...r, name: 'tvOS 26.2' }], /contradictorio/],
  ['build ausente', r => [{ ...r, buildversion: '' }], /identidad/],
  ['runtime ambiguo', r => [r, r], /ambiguo/],
]) test(`preflight rechaza ${name}`, () => {
  const f = toolchainFixture(); f.replies['xcrun simctl list runtimes -j'] = JSON.stringify({ runtimes: runtimes(f.runtime) });
  assert.throws(() => inspectSimulatorToolchain(f.run, f.options), message);
});
for (const [name, command, value, message] of [
  ['Xcode incorrecto', 'xcodebuild -version', 'Xcode 26.0.1\nBuild version 17A400', /Xcode distinto/],
  ['build Xcode incorrecto', 'xcodebuild -version', 'Xcode 26.2\nBuild version 17C529', /Xcode distinto/],
  ['SDK incorrecto', 'xcodebuild -showsdks', '-sdk iphonesimulator26.0', /SDK de simulador/],
  ['prefijo SDK engañoso', 'xcodebuild -showsdks', '-sdk iphonesimulator26.20', /SDK de simulador/],
  ['SDK efectivo distinto', 'xcrun --sdk iphonesimulator26.2 --show-sdk-version', '26.0', /SDK efectivo/],
  ['SDK de otro Xcode', 'xcrun --sdk iphonesimulator26.2 --show-sdk-path', '/Applications/Xcode_26.0.1.app/SDKs/iPhoneSimulator26.2.sdk', /mezcla/],
  ['host no evaluado', 'uname -m', 'x86_64', /Arquitectura/],
  ['JSON inválido', 'xcrun simctl list runtimes -j', '{', /JSON válido/],
  ['inventario sin runtimes', 'xcrun simctl list runtimes -j', '{}', /Inventario/],
]) test(`preflight rechaza ${name}`, () => {
  const f = toolchainFixture(); f.replies[command] = value;
  assert.throws(() => inspectSimulatorToolchain(f.run, f.options), message);
});
test('preflight rechaza DEVELOPER_DIR mezclado y Node bajo arquitectura diferente', () => {
  const f = toolchainFixture();
  assert.throws(() => inspectSimulatorToolchain(f.run, { ...f.options, developerDir: '/Applications/Xcode.app/Contents/Developer' }), /DEVELOPER_DIR/);
  assert.throws(() => inspectSimulatorToolchain(f.run, { ...f.options, nodeArch: 'x64' }), /Arquitectura/);
});
test('preflight propaga fallo de herramienta sin continuar ni reintentar', () => {
  const f = toolchainFixture(); let attempts = 0;
  assert.throws(() => inspectSimulatorToolchain((command, args) => {
    if (command === 'xcrun' && args[0] === 'simctl') { attempts++; throw Error('simctl unavailable'); }
    return f.run(command, args);
  }, f.options), /JSON válido/);
  assert.equal(attempts, 1);
});
test('SHA aprobado: rechaza ausencia, otro commit y formatos incompletos', () => {
  const sha = 'a'.repeat(40); verifyApprovedSha(sha, sha);
  for (const approved of [undefined, '', 'b'.repeat(40), sha.slice(0, 7), sha.toUpperCase()]) {
    assert.throws(() => verifyApprovedSha(approved, sha), /SHA fuente/);
  }
});
test('settings efectivos rechazan arquitectura, SDK y firma incompatibles', () => {
  const s = { PRODUCT_BUNDLE_IDENTIFIER: selection.appId, TARGETED_DEVICE_FAMILY: '1,2',
    CODE_SIGNING_ALLOWED: 'NO', CODE_SIGNING_REQUIRED: 'NO', CODE_SIGN_IDENTITY: '', DEVELOPMENT_TEAM: '',
    IPHONEOS_DEPLOYMENT_TARGET: '15.0', ARCHS: 'arm64 x86_64', PLATFORM_NAME: 'iphonesimulator', SDK_NAME: SIMULATOR_SDK };
  for (const patch of [{ ARCHS: 'x86_64' }, { EXCLUDED_ARCHS: 'arm64' }, { ARCHS: undefined },
    { SDK_NAME: 'iphonesimulator26.0' }, { CODE_SIGNING_ALLOWED: 'YES' }, { CODE_SIGN_IDENTITY: 'Apple Development' }]) {
    assert.throws(() => verifySimulatorSettings([{ target: 'App', buildSettings: { ...s, ...patch } }], selection));
  }
});
test('script invoca preflight antes de settings/build y conserva evidencia de runtime', async () => {
  const script = await readFile(join(front, 'scripts/build-ios-simulator.mjs'), 'utf8');
  const probe = script.indexOf('const toolchain = inspectSimulatorToolchain(');
  assert.ok(probe > script.indexOf('verifyApprovedSha(process.env.IOS_APPROVED_SHA, sha)'));
  assert.ok(probe < script.indexOf('await verifyIosProject('));
  assert.ok(probe < script.indexOf("execFileSync('xcodebuild', args"));
  assert.ok(script.includes('sha, xcode, toolchain'));
});

test('Windows rechaza generación/compilación real antes de crear proyecto', { skip: process.platform === 'darwin' }, () => {
  for (const script of ['prepare-ios.mjs', 'build-ios-simulator.mjs']) {
    const result = spawnSync(process.execPath, [join(front, 'scripts', script)], { encoding: 'utf8', env: { ...process.env, ...env } });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /requiere macOS/);
  }
});
