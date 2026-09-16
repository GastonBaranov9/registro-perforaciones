import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { runGradleReleaseProbe } from './native-gradle-release-probe.mjs';
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
const SIGNING_FIELDS = ['storeFile', 'storePassword', 'keyAlias', 'keyPassword'];
const EXTERNAL_SOURCE_NAME = '[A-Za-z_][A-Za-z0-9_.-]*';
const RESERVED_SIGNING_ENVIRONMENT_NAMES = new Set([
  'ANDROID_HOME',
  'ANDROID_SDK_ROOT',
  'APPDATA',
  'COMSPEC',
  'GRADLE_USER_HOME',
  'HOME',
  'JAVA_HOME',
  'LOCALAPPDATA',
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'USERPROFILE',
]);

function entry(status, item, detail, extra = {}) {
  return { status, item, detail, ...extra };
}

function stringResource(source, name) {
  const value = new RegExp(`<string\\s+name=["']${name}["'][^>]*>([\\s\\S]*?)<\\/string>`)
    .exec(source)?.[1]?.trim();
  return value?.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"').replaceAll('&apos;', "'");
}

function normalizeGradleSource(source) {
  let result = '';
  let index = 0;
  let quote = null;
  let quoteLength = 0;
  let malformed = false;
  const delimiters = [];

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
      let closed = false;
      while (index < source.length) {
        if (source[index] === '*' && source[index + 1] === '/') {
          result += '  ';
          index += 2;
          closed = true;
          break;
        }
        result += source[index] === '\r' || source[index] === '\n' ? source[index] : ' ';
        index += 1;
      }
      if (!closed) malformed = true;
      continue;
    }
    if (char === '{' || char === '(' || char === '[') delimiters.push(char);
    if (char === '}' || char === ')' || char === ']') {
      const expected = { '}': '{', ')': '(', ']': '[' }[char];
      if (delimiters.pop() !== expected) malformed = true;
    }
    result += char;
    index += 1;
  }
  return { source: result, malformed: malformed || quote !== null || delimiters.length > 0 };
}

export function stripGradleComments(source) {
  return normalizeGradleSource(source).source;
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
  let depth = 0;
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
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0 || !source.startsWith(name, index)) continue;
    const afterName = source[index + name.length];
    if (afterName && /[A-Za-z0-9_$]/.test(afterName)) continue;
    let previous = index - 1;
    while (previous >= 0 && (source[previous] === ' ' || source[previous] === '\t')) previous -= 1;
    if (previous >= 0 && !/[;{}\r\n]/.test(source[previous])) continue;
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

function directGradleStatements(source) {
  const statements = [];
  let current = '';
  let quote = null;
  let quoteLength = 0;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  const finish = () => {
    if (current.trim()) statements.push(current.trim());
    current = '';
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      const delimiter = quote.repeat(quoteLength);
      if (source.startsWith(delimiter, index)) {
        if (braces === 0) current += delimiter;
        index += quoteLength - 1;
        quote = null;
        quoteLength = 0;
      } else if (quoteLength === 1 && char === '\\' && index + 1 < source.length) {
        if (braces === 0) current += source.slice(index, index + 2);
        index += 1;
      } else if (braces === 0) {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoteLength = source.startsWith(char.repeat(3), index) ? 3 : 1;
      if (braces === 0) current += char.repeat(quoteLength);
      index += quoteLength - 1;
      continue;
    }
    if (char === '{') {
      if (braces === 0) finish();
      braces += 1;
      continue;
    }
    if (char === '}') {
      braces = Math.max(0, braces - 1);
      continue;
    }
    if (braces > 0) continue;
    if (char === '(') parentheses += 1;
    if (char === ')') parentheses = Math.max(0, parentheses - 1);
    if (char === '[') brackets += 1;
    if (char === ']') brackets = Math.max(0, brackets - 1);
    if ((char === ';' || char === '\r' || char === '\n') &&
        parentheses === 0 && brackets === 0) {
      finish();
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      continue;
    }
    current += char;
  }
  finish();
  return statements;
}

function signingAssignments(source, name) {
  const directive = new RegExp(`^${name}\\b\\s*(?:=\\s*)?([\\s\\S]+)$`);
  return directGradleStatements(source)
    .map((statement) => directive.exec(statement)?.[1]?.trim())
    .filter((value) => value !== undefined);
}

function externalSigningSource(expression, field) {
  let value = expression.trim();
  if (field === 'storeFile') {
    const fileCall = /^(?:rootProject\.)?file\(\s*([\s\S]+)\s*\)$/.exec(value);
    if (!fileCall) return undefined;
    value = fileCall[1].trim();
  }
  const patterns = [
    {
      kind: 'environment',
      regex: new RegExp(`^providers\\.environmentVariable\\(\\s*(["'])(${EXTERNAL_SOURCE_NAME})\\1\\s*\\)\\.get\\(\\)$`),
    },
    {
      kind: 'environment',
      regex: new RegExp(`^System\\.getenv\\(\\s*(["'])(${EXTERNAL_SOURCE_NAME})\\1\\s*\\)$`),
    },
  ];
  for (const { kind, regex } of patterns) {
    const name = regex.exec(value)?.[2];
    if (!name || name.startsWith('RSP_PROBE_')) continue;
    if (kind === 'environment' && RESERVED_SIGNING_ENVIRONMENT_NAMES.has(name.toUpperCase())) continue;
    return { kind, name };
  }
  return undefined;
}

export function inspectReleaseSigningSource(appBuild) {
  const normalized = normalizeGradleSource(appBuild);
  if (normalized.malformed) {
    return {
      error: 'la fuente Gradle tiene delimitadores, strings o comentarios sin cierre',
      fields: undefined,
      probeSources: [],
    };
  }
  const androidBlocks = namedBlocks(normalized.source, 'android');
  const signingConfigs = androidBlocks.length === 1
    ? namedBlocks(androidBlocks[0], 'signingConfigs')
    : [];
  const releases = signingConfigs.length === 1
    ? namedBlocks(signingConfigs[0], 'release')
    : [];
  if (androidBlocks.length !== 1 || signingConfigs.length !== 1 || releases.length !== 1) {
    return {
      error: releases.length === 0
        ? 'no existe signingConfigs.release canónico'
        : 'la estructura signingConfigs.release es duplicada o ambigua',
      fields: undefined,
      probeSources: [],
    };
  }

  const values = Object.fromEntries(
    SIGNING_FIELDS.map((field) => [field, signingAssignments(releases[0], field)]),
  );
  const probeSources = Object.entries(values).flatMap(([field, assignments]) =>
    assignments.map((value) => {
      const source = externalSigningSource(value, field);
      return source ? { field, ...source } : undefined;
    }).filter(Boolean));
  const missing = Object.entries(values)
    .filter(([, assignments]) => assignments.length === 0)
    .map(([field]) => field);
  if (missing.length > 0) {
    return {
      error: `faltan campos canónicos: ${missing.join(', ')}`,
      fields: undefined,
      probeSources,
    };
  }
  const duplicated = Object.entries(values)
    .filter(([, assignments]) => assignments.length !== 1)
    .map(([field]) => field);
  if (duplicated.length > 0) {
    return {
      error: `asignaciones canónicas duplicadas: ${duplicated.join(', ')}`,
      fields: undefined,
      probeSources,
    };
  }
  const fields = Object.fromEntries(Object.entries(values).map(([field, [value]]) => [
    field,
    externalSigningSource(value, field),
  ]));
  const unsafe = Object.entries(fields)
    .filter(([, source]) => !source)
    .map(([field]) => field);
  if (unsafe.length > 0) {
    return {
      error: `campos sin variable de entorno directa permitida: ${unsafe.join(', ')}`,
      fields: undefined,
      probeSources,
    };
  }
  return { fields, probeSources };
}

export async function discoverMainActivities(javaRoot) {
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (item) => {
      const path = join(directory, item.name);
      if (item.isDirectory()) return visit(path);
      if (item.name !== 'MainActivity.java' && item.name !== 'MainActivity.kt') return [];
      return [{
        relativePath: relative(javaRoot, path).replaceAll('\\', '/'),
        source: await readFile(path, 'utf8'),
      }];
    }));
    return nested.flat();
  }
  return visit(javaRoot);
}

export function selectEffectiveReleaseVariant(gradleProbe) {
  if (gradleProbe?.error) return { error: gradleProbe.error };
  const variants = gradleProbe?.variants;
  if (!Array.isArray(variants)) return { error: 'no existe un reporte Gradle release válido' };
  if (variants.length === 0) return { error: 'Gradle no informó variantes release' };
  if (variants.length > 1) {
    return { error: `Gradle informó ${variants.length} variantes release y no existe una política de selección` };
  }
  if (variants[0]?.buildType !== 'release') {
    return { error: 'Gradle informó una variante que no corresponde al build type release' };
  }
  return { variant: variants[0] };
}

export function evaluateAndroidIdentity({
  capacitor,
  gradleProbe,
  strings,
  mainActivities,
}) {
  const selected = selectEffectiveReleaseVariant(gradleProbe);
  if (selected.error) {
    return entry(READINESS_STATUS.technicalBlocker, 'application identity', selected.error, { coherent: false });
  }
  const appId = /\bappId\s*:\s*["']([^"']+)["']/.exec(capacitor)?.[1];
  const applicationId = selected.variant.applicationId;
  const namespace = selected.variant.namespace;
  const packageName = stringResource(strings, 'package_name');
  const required = { appId, applicationId, namespace, packageName };
  if (Object.values(required).some((value) => !value)) {
    return entry(READINESS_STATUS.technicalBlocker, 'application identity', 'faltan referencias obligatorias de identidad efectiva', { coherent: false });
  }
  if (!ANDROID_ID.test(appId)) {
    return entry(READINESS_STATUS.technicalBlocker, 'application identity', 'appId no es un identificador Android válido', { coherent: false, appId });
  }
  if (new Set(Object.values(required)).size !== 1) {
    return entry(READINESS_STATUS.technicalBlocker, 'application identity', 'Capacitor, applicationId efectivo, namespace y package_name no coinciden', { coherent: false, appId });
  }
  const candidates = mainActivities.filter(({ source }) => /\bclass\s+MainActivity\b/.test(source));
  if (candidates.length !== 1) {
    return entry(READINESS_STATUS.technicalBlocker, 'application identity', 'debe existir un único MainActivity', { coherent: false, appId });
  }
  const activityPackage = /^\s*package\s+([A-Za-z][A-Za-z0-9_.]*)\s*[;\r\n]/m
    .exec(candidates[0].source)?.[1];
  const extension = candidates[0].relativePath.endsWith('.kt') ? 'kt' : 'java';
  const expectedPath = `${appId.replaceAll('.', '/')}/MainActivity.${extension}`;
  if (activityPackage !== appId || candidates[0].relativePath !== expectedPath) {
    return entry(READINESS_STATUS.technicalBlocker, 'application identity', 'package y ruta de MainActivity no corresponden al appId', { coherent: false, appId });
  }
  if (appId === PLACEHOLDER_APP_ID) {
    return entry(READINESS_STATUS.humanDecision, 'application identity', 'continúa el appId placeholder', { coherent: true, appId });
  }
  return entry(READINESS_STATUS.ready, 'application identity', `identidad release efectiva coherente: ${appId}`, { coherent: true, appId });
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

function effectiveVersion(variant) {
  const outputs = Array.isArray(variant?.outputs)
    ? variant.outputs.filter(({ enabled }) => enabled !== false)
    : [];
  if (outputs.length === 0) return { error: 'la variante release no tiene outputs habilitados' };
  const versions = new Map(outputs.map(({ versionCode, versionName }) => [
    JSON.stringify([versionCode, versionName]),
    { versionCode, versionName },
  ]));
  if (versions.size !== 1) {
    return { error: 'los outputs release informan versiones efectivas distintas' };
  }
  return [...versions.values()][0];
}

export function evaluateVersion(gradleProbe) {
  const selected = selectEffectiveReleaseVariant(gradleProbe);
  if (selected.error) {
    return entry(READINESS_STATUS.technicalBlocker, 'release version', selected.error);
  }
  const version = effectiveVersion(selected.variant);
  if (version.error) {
    return entry(READINESS_STATUS.technicalBlocker, 'release version', version.error);
  }
  const versionCode = Number(version.versionCode);
  const versionName = version.versionName;
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0 || versionCode > 2_100_000_000) {
    return entry(READINESS_STATUS.technicalBlocker, 'release version', 'versionCode efectivo debe ser un entero Android positivo');
  }
  if (typeof versionName !== 'string' || !versionName || versionName.trim() !== versionName ||
      /[\u0000-\u001f\u007f]/.test(versionName)) {
    return entry(READINESS_STATUS.technicalBlocker, 'release version', 'versionName efectivo debe ser un texto no vacío y sin caracteres de control');
  }
  return entry(READINESS_STATUS.ready, 'release version', `versionCode=${versionCode}; versionName=${versionName}`);
}

export function evaluateReleaseDebuggable(gradleProbe) {
  const selected = selectEffectiveReleaseVariant(gradleProbe);
  if (selected.error) {
    return entry(READINESS_STATUS.technicalBlocker, 'release debuggable', selected.error);
  }
  if (selected.variant.debuggable === true) {
    return entry(READINESS_STATUS.technicalBlocker, 'release debuggable', 'la variante release efectiva habilita debuggable');
  }
  if (selected.variant.debuggable !== false) {
    return entry(READINESS_STATUS.technicalBlocker, 'release debuggable', 'Gradle no informó un booleano efectivo para debuggable');
  }
  return entry(READINESS_STATUS.ready, 'release debuggable', 'la variante release efectiva declara debuggable=false');
}

export function evaluateReleaseSigning({ appBuild, gradleProbe, signingContract }) {
  const contract = signingContract ?? inspectReleaseSigningSource(appBuild);
  if (contract.error) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', contract.error);
  }
  const selected = selectEffectiveReleaseVariant(gradleProbe);
  if (selected.error) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', selected.error);
  }
  const signing = selected.variant.signing;
  if (!signing?.selectedIsCanonicalRelease || signing.selectedName !== 'release') {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'la variante release no selecciona signingConfigs.release');
  }
  if (signing.effectiveSelectionMatchesCanonicalMarker !== true) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'el signing efectivo de la variante no conserva la configuración release atestiguada');
  }
  if (signing.selectionUnambiguous !== true) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'defaultConfig o productFlavors introducen una selección de signing ambigua');
  }
  const missing = SIGNING_FIELDS.filter((field) => signing.fields?.[field]?.present !== true);
  if (missing.length > 0) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', `faltan campos efectivos: ${missing.join(', ')}`);
  }
  const mismatched = SIGNING_FIELDS.filter((field) =>
    signing.fields?.[field]?.matchesSentinel !== true);
  if (mismatched.length > 0) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', `campos efectivos no coinciden con sus fuentes sentinel: ${mismatched.join(', ')}`);
  }
  return entry(
    READINESS_STATUS.ready,
    'release signing',
    'signingConfigs.release efectivo coincide con las cuatro variables de entorno sentinel',
  );
}

export function evaluateNativeReleaseReadiness(inputs) {
  let originResult;
  try {
    validateNativeBackendOrigin(inputs.origin, 'production');
    originResult = entry(READINESS_STATUS.ready, 'backend production origin', 'origin HTTPS productivo válido');
  } catch (error) {
    originResult = entry(READINESS_STATUS.technicalBlocker, 'backend production origin', error instanceof Error ? error.message : 'origin inválido');
  }
  const entries = [
    originResult,
    evaluateAndroidIdentity(inputs),
    evaluateAppName(inputs),
    evaluateVersion(inputs.gradleProbe),
    evaluateReleaseDebuggable(inputs.gradleProbe),
    evaluateReleaseSigning(inputs),
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
  const signingContract = inspectReleaseSigningSource(appBuild);
  const androidRoot = join(frontRoot, 'android');
  let gradleProbe;
  try {
    gradleProbe = await runGradleReleaseProbe({
      projectRoot: androidRoot,
      wrapperRoot: androidRoot,
      signingContract,
    });
  } catch (error) {
    gradleProbe = {
      error: error instanceof Error ? error.message : 'Gradle release probe falló',
      variants: [],
    };
  }
  return {
    origin,
    capacitor,
    appBuild,
    strings,
    mainActivities,
    signingContract,
    gradleProbe,
  };
}
