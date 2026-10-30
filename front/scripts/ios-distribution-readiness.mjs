// Read-only preparation audit. Never signs, archives, uploads or contacts Apple.
import { execFileSync } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { check, iosSelection, iosPolicy, plist, loadProject, verifyProject, verifyInfo, verifyIosSpm, unquote } from './ios-contract.mjs';
import { verifyIosBranding } from './ios-branding.mjs';
import { verifyApprovedSha } from './ios-simulator-contract.mjs';
import { nativeCsp } from './native-artifact.mjs';
import { deriveNativeWebsocketOrigin } from './native-backend-config.mjs';

export const BRANCH = 'feature/rsp-mobile-multiplataforma';
export const BUNDLE = 'uy.com.raulsilva.perforaciones';
export const ORIGIN = 'https://api.raulsilvaperforaciones.com';
const repository = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const lockPath = 'App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved';
const lockHash = '56a364979903d2990a2eaad3fb86781113e286e27d4c7d63a7945dc9722ae9df';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const production = () => iosSelection({ RSP_MOBILE_VARIANT: 'production', NATIVE_BACKEND_ORIGIN: ORIGIN });

export function verifyGitIdentity({ branch, origin, pushOrigin, sha }, approvedSha) {
  const urls = ['https://github.com/GastonBaranov9/registro-perforaciones.git', 'git@github.com:GastonBaranov9/registro-perforaciones.git'];
  check(branch === BRANCH && urls.includes(origin) && urls.includes(pushOrigin), 'Rama/origin no autorizados.');
  verifyApprovedSha(approvedSha, sha);
}

export function verifyResolved(bytes) {
  const lock = JSON.parse(bytes.toString('utf8'));
  check(lock.version === 3 && Array.isArray(lock.pins) && lock.pins.length === 4 &&
    /^[a-f0-9]{64}$/.test(lock.originHash), 'Package.resolved inválido.');
  check(hash(bytes) === lockHash, 'Package.resolved difiere del lock compilado y aprobado.');
  return lock.pins.map(pin => ({ name: pin.identity, version: pin.state.version, revision: pin.state.revision }));
}

export function verifyVersions(info, settings) {
  check(info.CFBundleShortVersionString === '$(MARKETING_VERSION)' &&
    info.CFBundleVersion === '$(CURRENT_PROJECT_VERSION)', 'Info.plist no deriva ambas versiones del proyecto.');
  check(/^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/.test(settings.MARKETING_VERSION), 'MARKETING_VERSION inválida.');
  check(/^[1-9]\d{0,3}$/.test(settings.CURRENT_PROJECT_VERSION), 'CURRENT_PROJECT_VERSION inválido.');
  return { version: settings.MARKETING_VERSION, build: settings.CURRENT_PROJECT_VERSION };
}

export function inspectRelease(project, info) {
  verifyProject(project, production());
  const objects = project.hash.project.objects;
  const target = Object.entries(objects.PBXNativeTarget).find(([key]) => !key.endsWith('_comment'))[1];
  const configs = objects.XCConfigurationList[target.buildConfigurationList].buildConfigurations
    .map(ref => objects.XCBuildConfiguration[ref.value]);
  const release = configs.filter(c => unquote(c.name) === 'Release');
  check(release.length === 1, 'Falta configuración Release única.');
  const versions = configs.map(c => verifyVersions(info, Object.fromEntries(
    Object.entries(c.buildSettings).map(([k, v]) => [k, unquote(v)]))));
  check(JSON.stringify(versions[0]) === JSON.stringify(versions[1]), 'Versiones Debug/Release contradictorias.');
  const s = release[0].buildSettings;
  check(!release[0].baseConfigurationReference && !/DEBUG/.test(unquote(s.SWIFT_ACTIVE_COMPILATION_CONDITIONS)) &&
    !/DEBUG/.test(unquote(s.OTHER_SWIFT_FLAGS)) && !s.CAPACITOR_DEBUG, 'Release hereda configuración de depuración.');
  check(unquote(s.INFOPLIST_FILE) === 'App/Info.plist' && unquote(s.ASSETCATALOG_COMPILER_APPICON_NAME) === 'AppIcon', 'Release usa recursos inesperados.');
  return { ...versions[0], signing: unquote(s.CODE_SIGN_STYLE) + ' sin Team ID; NO preparado para firmar',
    deviceCapabilities: info.UIRequiredDeviceCapabilities,
    deviceArchive: 'Pendiente: capabilities arm64 y Apple Distribution efectivos; no reutilizar firma iPhone Developer del template.' };
}

// Deliberately narrower than Apple's possible formats: positive integer 1..9999.
// lastAllocated must later come from a durable reservation ledger + ASC review.
// This pure validator DOES NOT reserve a build or prove its remote uniqueness.
export function validateCandidate({ bundleId, approvedSha, sourceSha, version, build, lastAllocated }) {
  check(bundleId === BUNDLE, 'Identidad de candidato incorrecta.');
  verifyApprovedSha(approvedSha, sourceSha);
  check(typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), 'Candidato requiere versión numérica de tres componentes.');
  check(typeof build === 'string' && /^[1-9]\d{0,3}$/.test(build), 'Build candidato requiere entero canónico 1..9999.');
  check(typeof lastAllocated === 'string' && /^(0|[1-9]\d{0,3})$/.test(lastAllocated), 'Falta último número reservado verificado.');
  check(Number(build) > Number(lastAllocated), 'Build reutilizado o no creciente.');
  return { bundleId, sourceSha, marketingVersion: version, currentProjectVersion: build,
    reservationVerified: false, readyForTestFlight: false };
}

export function verifyPublicationFile(name, bytes) {
  check(!/(?:\.(?:p8|p12|pfx|pem|cer|crt|key|mobileprovision|provisionprofile|ipa)|(?:^|\/)\.env(?:\.[^/]+)?)$/i.test(name) ||
    /(?:\.example|\.template)$/.test(name), 'Archivo privado/de firma no permitido: ' + name);
  check(!/(?:\.app\/|\/DerivedData\/|\/xcuserdata\/|^front\/ios\/App\/App\/public\/|(?:^|\/)simulator-app\.tgz$)/i.test(name), 'Artefacto generado no permitido: ' + name);
  // Full payload patterns, not documentation mentioning a PEM header or test regex.
  let text = bytes.toString('utf8');
  // Existing public negative fixture: deliberately not a usable random token.
  // No blanket exemption for tests or other credentials in this file.
  if (name === 'api/test/websocket-native-contract.test.ts') {
    text = text.replaceAll('rspn1_' + 'a'.repeat(43), '<known-invalid-native-token>');
  }
  check(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{48,}/.test(text) &&
    !/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{35}|rspn1_[A-Za-z0-9_-]{43})\b/.test(text),
  'Posible secreto versionado (contenido omitido): ' + name);
}

export function readinessReport(passed = [], failed = [], details = {}, dirty = false) {
  return {
    status: failed.length ? 'LOCAL_CHECKS_FAILED' : 'LOCAL_CHECKS_PASSED_WITH_BLOCKERS',
    readyForTestFlight: false, passed, failed, details,
    pending: [
      ...(dirty ? ['Árbol con cambios: revisar/commitear y aprobar el SHA definitivo antes de cualquier archive.'] : []),
      'Reservar build único y versión de distribución; este informe no reserva números ni consulta ASC.',
      'Antes del archive de dispositivo, corregir/revalidar UIRequiredDeviceCapabilities para arm64; template actual declara armv7.',
      'Privacidad, derechos de marca y evaluación de cifrado/export compliance pendientes del propietario.',
      'Entorno protegido y procedimiento CI de firma/subida requieren autorización independiente.',
    ],
    appleMembershipBlocked: [
      'Membresía pendiente según propietario; no consultada en Apple. Confirmar activación y acuerdos.',
      'Team ID, App ID explícito, registro ASC, Apple Distribution y perfil ASC pendientes; no inventados.',
    ],
    requiresMacOS: [
      'Archive Release iphoneos arm64 firmado y validación de entitlements, perfil, certificado y versiones efectivas.',
      'Reporte agregado de privacidad, assets finales, exportación/validación y procesamiento de Apple.',
    ],
    requiresPhysicalDevice: [
      'iPhone/iPad: login, Keychain, permisos, cámara/GPS/PDF, teclado, rotación y suspensión.',
      'Offline/sincronización y ausencia de duplicados no probados físicamente; escrituras requieren otra autorización.',
    ],
  };
}

export async function auditReadiness(root, approvedSha, candidate) {
  const front = join(root, 'front'), ios = join(front, 'ios');
  const run = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
  const passed = [], failed = [], details = {};
  const probe = async (id, action) => {
    try { const result = await action(); if (result !== undefined) details[id] = result; passed.push(id); }
    catch { failed.push(id); } // Do not print command stderr, file contents or credentials.
  };
  const sha = run('rev-parse', 'HEAD'), dirty = Boolean(run('status', '--porcelain=v1'));
  await probe('git_identity', () => {
    verifyGitIdentity({ branch: run('branch', '--show-current'), origin: run('remote', 'get-url', 'origin'),
      pushOrigin: run('remote', 'get-url', '--push', 'origin'), sha }, approvedSha);
    return { sha, branch: BRANCH, dirty };
  });
  await probe('native_project_release_permissions', async () => {
    const policy = await iosPolicy(front);
    const info = plist.parse(await readFile(join(ios, 'App/App/Info.plist'), 'utf8'));
    verifyInfo(info, production(), policy);
    const result = inspectRelease(loadProject(ios), info);
    check((await readFile(join(ios, 'App/App/PrivacyInfo.xcprivacy'))).equals(await readFile(join(front, 'native/ios/PrivacyInfo.xcprivacy'))), 'Privacidad alterada.');
    return result;
  });
  await probe('swift_lock_and_plugins', async () => {
    await verifyIosSpm(front, ios);
    return verifyResolved(await readFile(join(ios, lockPath)));
  });
  await probe('capacitor_8_5_0', async () => {
    const pkg = JSON.parse(await readFile(join(front, 'package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(front, 'package-lock.json'), 'utf8'));
    for (const name of ['@capacitor/ios', '@capacitor/core', '@capacitor/cli']) {
      check((pkg.dependencies[name] ?? pkg.devDependencies[name]) === '8.5.0' &&
        lock.packages['node_modules/' + name].version === '8.5.0', 'Capacitor desalineado.');
    }
  });
  await probe('branding', async () => { await verifyIosBranding(front, ios); });
  await probe('https_wss_csp', async () => {
    const config = await readFile(join(front, 'capacitor.config.ts'), 'utf8');
    check(config.includes("appId: '" + BUNDLE + "'") && config.includes("appName: 'Raul Silva Perforaciones'") &&
      !/server\s*:|cleartext\s*:|allowNavigation\s*:|webContentsDebuggingEnabled\s*:/.test(config), 'Configuración Capacitor no evaluada.');
    check(deriveNativeWebsocketOrigin(ORIGIN) === 'wss://api.raulsilvaperforaciones.com', 'WSS incorrecto.');
    return { origin: ORIGIN, websocket: deriveNativeWebsocketOrigin(ORIGIN), csp: nativeCsp(ORIGIN),
      packagedAssets: 'Pendiente de verificar sobre el futuro archive; no se ejecutó build.' };
  });
  await probe('manual_simulator_unchanged', async () => {
    const path = '.github/workflows/ios-simulator.yml';
    const bytes = await readFile(join(root, path));
    const workflow = JSON.parse(bytes.toString('utf8'));
    check(Object.keys(workflow.on).join() === 'workflow_dispatch' && workflow.permissions?.contents === 'read', 'Workflow automático/permisos incorrectos.');
    // Audited baseline. Distribution tooling must not weaken the working simulator.
    check(hash(bytes) === hash(execFileSync('git', ['show', '232f12553c726be7ad99eb62033d00a5ab5cad1e:' + path], { cwd: root })), 'Workflow de simulador modificado.');
  });
  await probe('tracked_publication_scan', async () => {
    const files = run('ls-files', '-z').split('\0').filter(Boolean);
    for (const name of files) {
      check(!(await lstat(join(root, name))).isSymbolicLink(), 'Symlink versionado no evaluado.');
      verifyPublicationFile(name, await readFile(join(root, name)));
    }
    return { files: files.length, scope: 'Archivos versionados actuales, no historial ni archivos privados ignorados; detección por patrones, no certificación exhaustiva.' };
  });
  await probe('script_syntax', () => {
    for (const name of ['ios-contract.mjs', 'ios-simulator-contract.mjs', 'prepare-ios.mjs', 'verify-ios.mjs',
      'build-ios-simulator.mjs', 'ios-branding.mjs', 'ios-distribution-readiness.mjs']) {
      execFileSync(process.execPath, ['--check', join(front, 'scripts', name)], { stdio: 'pipe' });
    }
  });
  if (candidate) await probe('candidate_plan_not_reserved', () => validateCandidate({ ...candidate,
    bundleId: BUNDLE, approvedSha, sourceSha: sha }));
  return readinessReport(passed, failed, details, dirty);
}

export function parseArguments(args) {
  const allowed = ['--approved-sha', '--version', '--build', '--last-allocated'];
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    check(allowed.includes(args[i]) && args[i + 1] && !Object.hasOwn(values, args[i]), 'Argumentos inválidos o repetidos.');
    values[args[i]] = args[i + 1];
  }
  check(/^[0-9a-f]{40}$/.test(values['--approved-sha'] ?? ''), 'Exigir --approved-sha completo.');
  const count = ['--version', '--build', '--last-allocated'].filter(key => Object.hasOwn(values, key)).length;
  check(count === 0 || count === 3, 'El plan opcional requiere version, build y last-allocated juntos.');
  return { approvedSha: values['--approved-sha'], candidate: count ? {
    version: values['--version'], build: values['--build'], lastAllocated: values['--last-allocated'] } : undefined };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { approvedSha, candidate } = parseArguments(process.argv.slice(2));
    const report = await auditReadiness(repository, approvedSha, candidate);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.failed.length ? 1 : 2; // 2 = local checks pass, distribution BLOCKED.
  } catch { console.error('LOCAL_CHECKS_FAILED: revisar argumentos, Git y dependencias locales; no se realizó ninguna operación Apple.'); process.exitCode = 1; }
}
