import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { validateNativeBackendOrigin } from './native-backend-config.mjs';

export const READINESS_STATUS = Object.freeze({
  technicalBlocker: 'TECHNICAL_BLOCKER',
  humanDecision: 'HUMAN_DECISION',
  manualCheck: 'MANUAL_CHECK',
  ready: 'READY',
});

const PLACEHOLDER_APP_ID = 'com.example.app';
const PLACEHOLDER_APP_NAMES = new Set(['front']);
const ANDROID_ID = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

function entry(status, item, detail, extra = {}) {
  return { status, item, detail, ...extra };
}

function assignment(source, name, valuePattern) {
  return new RegExp(`\\b${name}\\s*(?:=\\s*)?${valuePattern}`, 'm').exec(source)?.[1];
}

function stringResource(source, name) {
  const value = new RegExp(`<string\\s+name=["']${name}["'][^>]*>([\\s\\S]*?)<\\/string>`)
    .exec(source)?.[1]?.trim();
  return value?.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"').replaceAll('&apos;', "'");
}

function namedBlock(source, name) {
  const opening = new RegExp(`\\b${name}\\s*\\{`, 'g').exec(source);
  if (!opening) return null;
  const start = source.indexOf('{', opening.index);
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (char === '\\') { index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return source.slice(start + 1, index);
  }
  return null;
}

export async function discoverMainActivities(javaRoot) {
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (item) => {
      const path = join(directory, item.name);
      if (item.isDirectory()) return visit(path);
      if (item.name !== 'MainActivity.java' && item.name !== 'MainActivity.kt') return [];
      return [{ relativePath: relative(javaRoot, path).replaceAll('\\', '/'), source: await readFile(path, 'utf8') }];
    }));
    return nested.flat();
  }
  return visit(javaRoot);
}

export function evaluateAndroidIdentity({ capacitor, appBuild, strings, mainActivities }) {
  const appId = /\bappId\s*:\s*["']([^"']+)["']/.exec(capacitor)?.[1];
  const applicationId = assignment(appBuild, 'applicationId', `["']([^"']+)["']`);
  const namespace = assignment(appBuild, 'namespace', `["']([^"']+)["']`);
  const packageName = stringResource(strings, 'package_name');
  const required = { appId, applicationId, namespace, packageName };
  if (Object.values(required).some((value) => !value)) {
    return entry(READINESS_STATUS.technicalBlocker, 'application identity', 'faltan referencias obligatorias de identidad', { coherent: false });
  }
  if (!ANDROID_ID.test(appId)) {
    return entry(READINESS_STATUS.technicalBlocker, 'application identity', 'appId no es un identificador Android válido', { coherent: false, appId });
  }
  if (new Set(Object.values(required)).size !== 1) {
    return entry(READINESS_STATUS.technicalBlocker, 'application identity', 'Capacitor, Gradle, namespace y package_name no coinciden', { coherent: false, appId });
  }
  const candidates = mainActivities.filter(({ source }) => /\bclass\s+MainActivity\b/.test(source));
  if (candidates.length !== 1) {
    return entry(READINESS_STATUS.technicalBlocker, 'application identity', 'debe existir un único MainActivity', { coherent: false, appId });
  }
  const activityPackage = /^\s*package\s+([A-Za-z][A-Za-z0-9_.]*)\s*[;\r\n]/m.exec(candidates[0].source)?.[1];
  const extension = candidates[0].relativePath.endsWith('.kt') ? 'kt' : 'java';
  const expectedPath = `${appId.replaceAll('.', '/')}/MainActivity.${extension}`;
  if (activityPackage !== appId || candidates[0].relativePath !== expectedPath) {
    return entry(READINESS_STATUS.technicalBlocker, 'application identity', 'package y ruta de MainActivity no corresponden al appId', { coherent: false, appId });
  }
  if (appId === PLACEHOLDER_APP_ID) {
    return entry(READINESS_STATUS.humanDecision, 'application identity', 'continúa el appId placeholder', { coherent: true, appId });
  }
  return entry(READINESS_STATUS.ready, 'application identity', `identidad coherente: ${appId}`, { coherent: true, appId });
}

export function evaluateAppName({ capacitor, strings }) {
  const capacitorName = /\bappName\s*:\s*["']([^"']+)["']/.exec(capacitor)?.[1]?.trim();
  const resourceName = stringResource(strings, 'app_name');
  const activityTitle = stringResource(strings, 'title_activity_main');
  if (!capacitorName || !resourceName || !activityTitle) {
    return entry(READINESS_STATUS.technicalBlocker, 'app name', 'faltan referencias obligatorias del nombre de aplicación');
  }
  if (capacitorName !== resourceName || resourceName !== activityTitle) {
    return entry(READINESS_STATUS.technicalBlocker, 'app name', 'Capacitor y recursos Android no usan el mismo nombre');
  }
  if (PLACEHOLDER_APP_NAMES.has(capacitorName.toLowerCase())) {
    return entry(READINESS_STATUS.humanDecision, 'app name', 'continúa el nombre placeholder');
  }
  return entry(READINESS_STATUS.ready, 'app name', `nombre coherente: ${capacitorName}`);
}

export function evaluateVersion(appBuild) {
  const versionCode = assignment(appBuild, 'versionCode', '(\\d+)');
  const versionName = assignment(appBuild, 'versionName', `["']([^"']*)["']`);
  const parsedCode = Number(versionCode);
  if (!Number.isSafeInteger(parsedCode) || parsedCode <= 0 || parsedCode > 2_100_000_000) {
    return entry(READINESS_STATUS.technicalBlocker, 'release version', 'versionCode debe ser un entero Android positivo');
  }
  if (!versionName || versionName.trim() !== versionName || /[\u0000-\u001f\u007f]/.test(versionName)) {
    return entry(READINESS_STATUS.technicalBlocker, 'release version', 'versionName debe ser un texto no vacío y sin caracteres de control');
  }
  return entry(READINESS_STATUS.ready, 'release version', `versionCode=${parsedCode}; versionName=${versionName}`);
}

function signingAssignment(source, name) {
  return new RegExp(`\\b${name}\\s*(?:=\\s*)?([^\\r\\n;]+)`).exec(source)?.[1]?.trim();
}

function safeExternalValue(value, field) {
  if (!value) return false;
  const argument = `["'][A-Za-z0-9_.-]+["']`;
  const provider = `providers\\.(?:environmentVariable|gradleProperty)\\(\\s*${argument}\\s*\\)\\.get\\(\\)`;
  const environment = `System\\.getenv\\(\\s*${argument}\\s*\\)`;
  const external = `(?:${provider}|${environment})`;
  const pattern = field === 'storeFile'
    ? new RegExp(`^(?:${external}|(?:rootProject\\.)?file\\(\\s*${external}\\s*\\))$`)
    : new RegExp(`^${external}$`);
  return pattern.test(value);
}

export function evaluateReleaseSigning(appBuild) {
  const signingConfigs = namedBlock(appBuild, 'signingConfigs');
  const releaseSigning = signingConfigs && namedBlock(signingConfigs, 'release');
  const buildTypes = namedBlock(appBuild, 'buildTypes');
  const releaseBuild = buildTypes && namedBlock(buildTypes, 'release');
  if (!releaseSigning) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'no existe signingConfigs.release');
  }
  if (/\bsigningConfig\s*(?:=\s*)?signingConfigs\.debug\b/.test(releaseBuild ?? '')) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'release usa signingConfigs.debug');
  }
  if (!releaseBuild || !/\bsigningConfig\s*(?:=\s*)?signingConfigs\.release\b/.test(releaseBuild)) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'buildTypes.release no usa signingConfigs.release');
  }
  const values = Object.fromEntries(['storeFile', 'storePassword', 'keyAlias', 'keyPassword']
    .map((name) => [name, signingAssignment(releaseSigning, name)]));
  const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', `faltan campos: ${missing.join(', ')}`);
  }
  const unsafe = Object.entries(values).filter(([name, value]) => !safeExternalValue(value, name)).map(([name]) => name);
  if (unsafe.length) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', `campos no externalizados o potencialmente hardcodeados: ${unsafe.join(', ')}`);
  }
  return entry(
    READINESS_STATUS.ready,
    'release signing',
    'referencias externas explícitas; Gradle debe validar disponibilidad, keystore y credenciales',
  );
}

export function evaluateNativeReleaseReadiness(inputs) {
  let originResult;
  try {
    const origin = validateNativeBackendOrigin(inputs.origin, 'production');
    originResult = entry(READINESS_STATUS.ready, 'backend production origin', 'origin HTTPS productivo válido');
  } catch (error) {
    originResult = entry(READINESS_STATUS.technicalBlocker, 'backend production origin', error instanceof Error ? error.message : 'origin inválido');
  }
  const entries = [
    originResult,
    evaluateAndroidIdentity(inputs),
    evaluateAppName(inputs),
    evaluateVersion(inputs.appBuild),
    evaluateReleaseSigning(inputs.appBuild),
    entry(READINESS_STATUS.manualCheck, 'branding assets', 'confirmar visualmente icono y splash definitivos'),
  ];
  const blockingStatuses = new Set([READINESS_STATUS.technicalBlocker, READINESS_STATUS.humanDecision]);
  const blocked = entries.some(({ status }) => blockingStatuses.has(status));
  return { entries, blocked, exitCode: blocked ? 2 : 0 };
}

export async function loadNativeReleaseInputs(frontRoot, origin) {
  const [capacitor, appBuild, strings, mainActivities] = await Promise.all([
    readFile(join(frontRoot, 'capacitor.config.ts'), 'utf8'),
    readFile(join(frontRoot, 'android/app/build.gradle'), 'utf8'),
    readFile(join(frontRoot, 'android/app/src/main/res/values/strings.xml'), 'utf8'),
    discoverMainActivities(join(frontRoot, 'android/app/src/main/java')),
  ]);
  return { origin, capacitor, appBuild, strings, mainActivities };
}
