import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { BRANCH, BUNDLE, verifyGitIdentity, verifyResolved, verifyVersions, inspectRelease,
  validateCandidate, verifyPublicationFile, readinessReport, parseArguments } from './ios-distribution-readiness.mjs';
import { loadProject, plist, iosPolicy, iosSelection, verifyInfo } from './ios-contract.mjs';

const front = dirname(dirname(fileURLToPath(import.meta.url))), root = dirname(front), ios = join(front, 'ios');
const sha = 'a'.repeat(40);
const git = { branch: BRANCH, origin: 'https://github.com/GastonBaranov9/registro-perforaciones.git',
  pushOrigin: 'https://github.com/GastonBaranov9/registro-perforaciones.git', sha };
const info = plist.parse(await readFile(join(ios, 'App/App/Info.plist'), 'utf8'));
const selection = iosSelection({ RSP_MOBILE_VARIANT: 'production', NATIVE_BACKEND_ORIGIN: 'https://api.raulsilvaperforaciones.com' });
const policy = await iosPolicy(front);
const lock = await readFile(join(ios, 'App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'));
const candidate = { bundleId: BUNDLE, approvedSha: sha, sourceSha: sha, version: '1.0.0', build: '2', lastAllocated: '1' };

test('readiness reconoce proyecto Release, Info.plist y versiones existentes sin modificarlas', () => {
  const result = inspectRelease(loadProject(ios), info);
  assert.equal(result.version, '1.0'); assert.equal(result.build, '1');
});
test('Git autorizado y SHA explícito', () => verifyGitIdentity(git, sha));
for (const [field, value] of [['branch', 'main'], ['origin', 'https://github.com/otro/repo.git'],
  ['pushOrigin', 'https://github.com/otro/repo.git'], ['sha', 'b'.repeat(40)]]) {
  test('rechaza Git ' + field, () => assert.throws(() => verifyGitIdentity({ ...git, [field]: value }, sha)));
}
test('cuatro revisiones Swift fijadas', () => assert.equal(verifyResolved(lock).length, 4));
for (const kind of ['json', 'version', 'revision', 'repository', 'extra']) test('rechaza lock ' + kind, () => {
  if (kind === 'json') return assert.throws(() => verifyResolved(Buffer.from('{')));
  const data = JSON.parse(lock);
  if (kind === 'version') data.pins[0].state.version = '8.6.0';
  if (kind === 'revision') data.pins[0].state.revision = 'b'.repeat(40);
  if (kind === 'repository') data.pins[0].location = 'https://example.test/unapproved.git';
  if (kind === 'extra') data.pins.push(data.pins[0]);
  assert.throws(() => verifyResolved(Buffer.from(JSON.stringify(data))));
});
test('plan candidato valida pero NO reserva ni autoriza TestFlight', () => {
  const result = validateCandidate(candidate);
  assert.equal(result.currentProjectVersion, '2'); assert.equal(result.reservationVerified, false);
  assert.equal(result.readyForTestFlight, false);
});
for (const [field, value] of [['bundleId', BUNDLE + '.pruebas'], ['sourceSha', 'b'.repeat(40)],
  ['approvedSha', undefined], ['version', '1.0'], ['version', '1.0.0-beta'], ['version', '01.0.0'],
  ['build', '0'], ['build', '02'], ['build', '1'], ['build', '10000'], ['build', '2.1'],
  ['build', '2;echo secret'], ['lastAllocated', undefined], ['lastAllocated', '3']]) {
  test(`rechaza candidato ${field}=${value}`, () => assert.throws(() => validateCandidate({ ...candidate, [field]: value })));
}
for (const [field, value] of [['version', 1], ['build', 2], ['lastAllocated', 1]]) {
  test('candidato exige string canónico para ' + field, () => assert.throws(() => validateCandidate({ ...candidate, [field]: value })));
}
test('Info.plist no puede fijar versiones distintas de los settings', () => {
  assert.throws(() => verifyVersions({ ...info, CFBundleVersion: '1' }, { MARKETING_VERSION: '1.0', CURRENT_PROJECT_VERSION: '1' }));
});
for (const [key, value] of [['PRODUCT_BUNDLE_IDENTIFIER', BUNDLE + '.pruebas'], ['IPHONEOS_DEPLOYMENT_TARGET', '26.2'],
  ['TARGETED_DEVICE_FAMILY', '1'], ['DEVELOPMENT_TEAM', 'NOTREAL'], ['SWIFT_ACTIVE_COMPILATION_CONDITIONS', 'DEBUG'],
  ['MARKETING_VERSION', '2.0'], ['CURRENT_PROJECT_VERSION', '2']]) {
  test('rechaza proyecto contradictorio ' + key, () => {
    const project = loadProject(ios);
    const configs = project.hash.project.objects.XCBuildConfiguration;
    const release = Object.values(configs).find(c => c.name === 'Release' && c.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER);
    release.buildSettings[key] = value;
    assert.throws(() => inspectRelease(project, info));
  });
}
for (const key of ['NSAppTransportSecurity', 'UIBackgroundModes', 'NSMicrophoneUsageDescription']) {
  test('rechaza permiso/configuración nueva ' + key, () => assert.throws(() => verifyInfo({ ...info, [key]: {} }, selection, policy)));
}
for (const file of ['front/ios/sign.p12', 'AuthKey.p8', 'certificate.cer', 'profile.mobileprovision',
  '.env', 'private/.env.production', 'out/App.app/App', 'front/ios/DerivedData/cache', 'front/ios/App/App/public/main.js']) {
  test('publicación rechaza ' + file, () => assert.throws(() => verifyPublicationFile(file, Buffer.from('synthetic'))));
}
test('secretos no se aceptan aunque tengan extensión de código', () => {
  for (const text of ['-----BEGIN ' + 'PRIVATE KEY-----\n' + 'A'.repeat(80), 'ghp_' + 'b'.repeat(36), 'rspn1_' + 'a'.repeat(43)]) {
    assert.throws(() => verifyPublicationFile('front/ios/a.swift', Buffer.from(text)));
  }
});
test('única excepción sintética no dispensa otros tokens del test', () => {
  const name = 'api/test/websocket-native-contract.test.ts';
  verifyPublicationFile(name, Buffer.from('rspn1_' + 'a'.repeat(43)));
  assert.throws(() => verifyPublicationFile(name, Buffer.from('rspn1_' + 'b'.repeat(43))));
});
test('ejemplo sin secretos permitido', () => verifyPublicationFile('config/.env.example', Buffer.from('API_ORIGIN=https://example.test')));
test('informe nunca declara listo para TestFlight y separa todos los pendientes', () => {
  for (const failures of [[], ['branding']]) {
    const report = readinessReport(['identity'], failures, {}, true);
    assert.equal(report.readyForTestFlight, false);
    for (const key of ['pending', 'appleMembershipBlocked', 'requiresMacOS', 'requiresPhysicalDevice']) assert.ok(report[key].length);
    assert.equal(report.status, failures.length ? 'LOCAL_CHECKS_FAILED' : 'LOCAL_CHECKS_PASSED_WITH_BLOCKERS');
  }
});
for (const args of [[], ['--approved-sha', sha, '--force', 'true'], ['--approved-sha', sha, '--build', '2'],
  ['--approved-sha', sha, '--approved-sha', sha], ['--approved-sha', 'short']]) {
  test('argumentos inválidos ' + args.join(' '), () => assert.throws(() => parseArguments(args)));
}
test('CLI sólo audita, termina con 2 por firma pendiente y no modifica Git', () => {
  const gitRun = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const before = gitRun('status', '--porcelain=v1');
  const actualSha = gitRun('rev-parse', 'HEAD');
  const result = spawnSync(process.execPath, ['scripts/ios-distribution-readiness.mjs', '--approved-sha', actualSha],
    { cwd: front, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.failed, []); assert.equal(report.readyForTestFlight, false);
  assert.equal(gitRun('status', '--porcelain=v1'), before);
});
