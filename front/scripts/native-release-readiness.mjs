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

export function stripGradleComments(source) {
  let result = '';
  let index = 0;
  let quote = null;
  let quoteLength = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      const delimiter = quote.repeat(quoteLength);
      if (source.startsWith(delimiter, index)) {
        result += delimiter;
        index += quoteLength;
        quote = null;
        quoteLength = 0;
        continue;
      }
      if (quoteLength === 1 && char === '\\' && index + 1 < source.length) {
        result += source.slice(index, index + 2);
        index += 2;
        continue;
      }
      result += char;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      quoteLength = source.startsWith(char.repeat(3), index) ? 3 : 1;
      result += char.repeat(quoteLength);
      index += quoteLength;
      continue;
    }

    if (char === '/' && next === '/') {
      result += '  ';
      index += 2;
      while (index < source.length && source[index] !== '\r' && source[index] !== '\n') {
        result += ' ';
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      result += '  ';
      index += 2;
      while (index < source.length) {
        if (source[index] === '*' && source[index + 1] === '/') {
          result += '  ';
          index += 2;
          break;
        }
        result += source[index] === '\r' || source[index] === '\n' ? source[index] : ' ';
        index += 1;
      }
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

function gradleBlockEnd(source, start) {
  let depth = 0;
  let quote = null;
  let quoteLength = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      const delimiter = quote.repeat(quoteLength);
      if (source.startsWith(delimiter, index)) {
        index += quoteLength - 1;
        quote = null;
        quoteLength = 0;
      } else if (quoteLength === 1 && char === '\\') {
        index += 1;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoteLength = source.startsWith(char.repeat(3), index) ? 3 : 1;
      index += quoteLength - 1;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return index;
  }
  return -1;
}

function namedBlocks(source, name) {
  const blocks = [];
  let quote = null;
  let quoteLength = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      const delimiter = quote.repeat(quoteLength);
      if (source.startsWith(delimiter, index)) {
        index += quoteLength - 1;
        quote = null;
        quoteLength = 0;
      } else if (quoteLength === 1 && char === '\\') {
        index += 1;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoteLength = source.startsWith(char.repeat(3), index) ? 3 : 1;
      index += quoteLength - 1;
      continue;
    }
    if (!source.startsWith(name, index)) continue;
    const previous = source[index - 1];
    const afterName = source[index + name.length];
    if ((previous && /[A-Za-z0-9_$]/.test(previous)) ||
        (afterName && /[A-Za-z0-9_$]/.test(afterName))) continue;
    let opening = index + name.length;
    while (/\s/.test(source[opening] ?? '')) opening += 1;
    if (source[opening] !== '{') continue;
    const end = gradleBlockEnd(source, opening);
    if (end === -1) return blocks;
    blocks.push(source.slice(opening + 1, end));
    index = end;
  }
  return blocks;
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

function gradleStatements(source) {
  const statements = [];
  let current = '';
  let quote = null;
  let quoteLength = 0;
  let parentheses = 0;
  let brackets = 0;

  const finishStatement = () => {
    if (current.trim()) statements.push(current.trim());
    current = '';
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      const delimiter = quote.repeat(quoteLength);
      if (source.startsWith(delimiter, index)) {
        current += delimiter;
        index += quoteLength - 1;
        quote = null;
        quoteLength = 0;
      } else if (quoteLength === 1 && char === '\\' && index + 1 < source.length) {
        current += source.slice(index, index + 2);
        index += 1;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      quoteLength = source.startsWith(char.repeat(3), index) ? 3 : 1;
      current += char.repeat(quoteLength);
      index += quoteLength - 1;
      continue;
    }

    if (char === '(') parentheses += 1;
    else if (char === ')') parentheses = Math.max(0, parentheses - 1);
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets = Math.max(0, brackets - 1);

    if ((char === ';' || char === '\r' || char === '\n' || char === '{' || char === '}') &&
        parentheses === 0 && brackets === 0) {
      finishStatement();
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      continue;
    }
    current += char;
  }
  finishStatement();
  return statements;
}

function signingAssignments(source, name) {
  const directive = new RegExp(`^${name}\\b\\s*(?:=\\s*)?([\\s\\S]+)$`);
  return gradleStatements(source)
    .map((statement) => directive.exec(statement)?.[1]?.trim())
    .filter((value) => value !== undefined);
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
  const effectiveSource = stripGradleComments(appBuild);
  const signingConfigs = namedBlocks(effectiveSource, 'signingConfigs');
  if (signingConfigs.length !== 1) {
    const detail = signingConfigs.length === 0
      ? 'no existe signingConfigs.release'
      : 'existen bloques signingConfigs duplicados o ambiguos';
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', detail);
  }
  const releaseSigning = namedBlocks(signingConfigs[0], 'release');
  if (releaseSigning.length !== 1) {
    const detail = releaseSigning.length === 0
      ? 'no existe signingConfigs.release'
      : 'existen bloques signingConfigs.release duplicados o ambiguos';
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', detail);
  }

  const buildTypes = namedBlocks(effectiveSource, 'buildTypes');
  if (buildTypes.length !== 1) {
    const detail = buildTypes.length === 0
      ? 'no existe buildTypes.release'
      : 'existen bloques buildTypes duplicados o ambiguos';
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', detail);
  }
  const releaseBuild = namedBlocks(buildTypes[0], 'release');
  if (releaseBuild.length !== 1) {
    const detail = releaseBuild.length === 0
      ? 'no existe buildTypes.release'
      : 'existen bloques buildTypes.release duplicados o ambiguos';
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', detail);
  }
  const signingConfigAssignments = signingAssignments(releaseBuild[0], 'signingConfig');
  if (signingConfigAssignments.length === 0) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'buildTypes.release no usa signingConfigs.release');
  }
  if (signingConfigAssignments.length > 1) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'buildTypes.release tiene asignaciones signingConfig duplicadas');
  }
  if (signingConfigAssignments[0] !== 'signingConfigs.release') {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'buildTypes.release no apunta exclusivamente a signingConfigs.release');
  }

  const assignments = Object.fromEntries(['storeFile', 'storePassword', 'keyAlias', 'keyPassword']
    .map((name) => [name, signingAssignments(releaseSigning[0], name)]));
  const missing = Object.entries(assignments).filter(([, values]) => values.length === 0).map(([name]) => name);
  if (missing.length) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', `faltan campos: ${missing.join(', ')}`);
  }
  const duplicated = Object.entries(assignments).filter(([, values]) => values.length > 1).map(([name]) => name);
  if (duplicated.length) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', `asignaciones duplicadas: ${duplicated.join(', ')}`);
  }
  const values = Object.fromEntries(Object.entries(assignments).map(([name, matches]) => [name, matches[0]]));
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
