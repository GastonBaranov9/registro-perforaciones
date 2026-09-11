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

    if (char === '{' || char === '(' || char === '[') {
      delimiters.push(char);
    } else if (char === '}' || char === ')' || char === ']') {
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
    if (depth !== 0) continue;
    if (!source.startsWith(name, index)) continue;
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

function canonicalAndroidBlocks(appBuild) {
  const normalized = normalizeGradleSource(appBuild);
  const effectiveSource = normalized.source;
  if (normalized.malformed) {
    return {
      effectiveSource,
      error: 'la sintaxis Gradle tiene delimitadores, strings o comentarios sin cierre',
    };
  }
  const androidBlocks = namedBlocks(effectiveSource, 'android');
  if (androidBlocks.length !== 1) {
    return {
      effectiveSource,
      error: androidBlocks.length === 0
        ? 'no existe un bloque android canónico'
        : 'existen bloques android duplicados o ambiguos',
    };
  }
  const androidSource = androidBlocks[0];
  const defaultConfigs = namedBlocks(androidSource, 'defaultConfig');
  return {
    effectiveSource,
    androidSource,
    defaultConfigSource: defaultConfigs.length === 1 ? defaultConfigs[0] : undefined,
    defaultConfigError: defaultConfigs.length === 0
      ? 'no existe un bloque android.defaultConfig canónico'
      : defaultConfigs.length > 1
        ? 'existen bloques android.defaultConfig duplicados o ambiguos'
        : undefined,
  };
}

function canonicalReleaseBuildBlocks(gradle) {
  const buildTypes = namedBlocks(gradle.androidSource, 'buildTypes');
  if (buildTypes.length !== 1) {
    return {
      error: buildTypes.length === 0
        ? 'no existe un bloque android.buildTypes canónico'
        : 'existen bloques android.buildTypes duplicados o ambiguos',
    };
  }
  const releaseBuilds = namedBlocks(buildTypes[0], 'release');
  if (releaseBuilds.length !== 1) {
    return {
      error: releaseBuilds.length === 0
        ? 'no existe un bloque android.buildTypes.release canónico'
        : 'existen bloques android.buildTypes.release duplicados o ambiguos',
    };
  }
  return { buildTypesSource: buildTypes[0], releaseBuildSource: releaseBuilds[0] };
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
  const gradle = canonicalAndroidBlocks(appBuild);
  if (gradle.error || gradle.defaultConfigError) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'application identity',
      gradle.error ?? gradle.defaultConfigError,
      { coherent: false },
    );
  }
  const namespaceResult = canonicalProperty(
    gradle.effectiveSource,
    gradle.androidSource,
    'namespace',
    quotedGradleLiteral,
  );
  const applicationIdResult = canonicalProperty(
    gradle.effectiveSource,
    gradle.defaultConfigSource,
    'applicationId',
    quotedGradleLiteral,
  );
  if (namespaceResult.error || applicationIdResult.error) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'application identity',
      namespaceResult.error ?? applicationIdResult.error,
      { coherent: false },
    );
  }
  const releaseIdentityError = releaseIdentityMutationError(gradle);
  if (releaseIdentityError) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'application identity',
      releaseIdentityError,
      { coherent: false, appId },
    );
  }
  const namespace = namespaceResult.value;
  const applicationId = applicationIdResult.value;
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
  const gradle = canonicalAndroidBlocks(appBuild);
  if (gradle.error || gradle.defaultConfigError) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'release version',
      gradle.error ?? gradle.defaultConfigError,
    );
  }
  const versionCodeResult = canonicalProperty(
    gradle.effectiveSource,
    gradle.defaultConfigSource,
    'versionCode',
    positiveIntegerGradleLiteral,
  );
  const versionNameResult = canonicalProperty(
    gradle.effectiveSource,
    gradle.defaultConfigSource,
    'versionName',
    quotedGradleLiteral,
  );
  if (versionCodeResult.error || versionNameResult.error) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'release version',
      versionCodeResult.error ?? versionNameResult.error,
    );
  }
  const versionCode = versionCodeResult.value;
  const versionName = versionNameResult.value;
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

function directGradleStatements(source) {
  const statements = [];
  let current = '';
  let quote = null;
  let quoteLength = 0;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;

  const finishStatement = () => {
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
      if (braces === 0) finishStatement();
      braces += 1;
      continue;
    }
    if (char === '}') {
      braces = Math.max(0, braces - 1);
      continue;
    }
    if (braces > 0) continue;

    if (char === '(') parentheses += 1;
    else if (char === ')') parentheses = Math.max(0, parentheses - 1);
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets = Math.max(0, brackets - 1);

    if ((char === ';' || char === '\r' || char === '\n') && parentheses === 0 && brackets === 0) {
      finishStatement();
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      continue;
    }
    current += char;
  }
  finishStatement();
  return statements;
}

const NAMED_CONTAINER_METHODS = new Set([
  'getByName',
  'named',
  'findByName',
  'maybeCreate',
  'create',
  'register',
  'getAt',
]);

function leadingGradlePath(statement) {
  const first = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(statement);
  if (!first) return undefined;
  const segments = [first[0]];
  const namedAccessors = [];
  let index = first[0].length;
  if (NAMED_CONTAINER_METHODS.has(first[0])) {
    let callStart = index;
    while (statement[callStart] === ' ' || statement[callStart] === '\t') callStart += 1;
    if (statement[callStart] === '(') {
      const accessor = /^\(\s*(["'])([A-Za-z0-9_.-]+)\1\s*\)/.exec(statement.slice(callStart));
      namedAccessors.push({ method: first[0], owner: undefined, target: accessor?.[2] });
      if (accessor) {
        segments.push(accessor[2]);
        index = callStart + accessor[0].length;
      }
    }
  }

  while (index < statement.length) {
    let opening = index;
    while (statement[opening] === ' ' || statement[opening] === '\t') opening += 1;
    if (statement[opening] === '.') {
      let identifierStart = opening + 1;
      while (statement[identifierStart] === ' ' || statement[identifierStart] === '\t') identifierStart += 1;
      const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(statement.slice(identifierStart));
      if (!identifier) break;
      segments.push(identifier[0]);
      index = identifierStart + identifier[0].length;
      let callStart = index;
      while (statement[callStart] === ' ' || statement[callStart] === '\t') callStart += 1;
      if (NAMED_CONTAINER_METHODS.has(identifier[0]) && statement[callStart] === '(') {
        const accessor = /^\(\s*(["'])([A-Za-z0-9_.-]+)\1\s*\)/.exec(statement.slice(callStart));
        namedAccessors.push({ method: identifier[0], owner: segments.at(-2), target: accessor?.[2] });
        if (!accessor) break;
        segments.push(accessor[2]);
        index = callStart + accessor[0].length;
      }
      continue;
    }
    if (statement[opening] === '[') {
      const bracket = /^\[\s*(["'])([A-Za-z_$][A-Za-z0-9_$]*)\1\s*\]/.exec(statement.slice(opening));
      if (!bracket) break;
      segments.push(bracket[2]);
      index = opening + bracket[0].length;
      continue;
    }
    break;
  }

  return { segments, namedAccessors, expression: statement.slice(index).trim() };
}

function propertyDirectives(statements, name) {
  const setter = `set${name[0].toUpperCase()}${name.slice(1)}`;
  return statements
    .map((statement) => {
      const directive = leadingGradlePath(statement);
      if (!directive) return undefined;
      const last = directive.segments.at(-1);
      const targetsProperty = last === name || last === setter ||
        (last === 'set' && directive.segments.at(-2) === name);
      return targetsProperty
        ? { path: directive.segments.join('.'), segments: directive.segments, expression: directive.expression }
        : undefined;
    })
    .filter((value) => value !== undefined);
}

function directPropertyAssignments(source, name) {
  return propertyDirectives(directGradleStatements(source), name)
    .filter(({ path }) => path === name)
    .map(({ expression }) => expression.replace(/^=\s*/, ''));
}

function quotedGradleLiteral(expression) {
  const doubleQuoted = /^"([^"\\$]*)"$/.exec(expression)?.[1];
  if (doubleQuoted !== undefined) return doubleQuoted;
  return /^'([^'\\]*)'$/.exec(expression)?.[1];
}

function positiveIntegerGradleLiteral(expression) {
  return /^\d+$/.test(expression) ? expression : undefined;
}

function canonicalProperty(effectiveSource, canonicalSource, name, parseValue) {
  const canonical = directPropertyAssignments(canonicalSource, name);
  if (canonical.length === 0) {
    return { error: `falta la asignación canónica de ${name}` };
  }
  if (canonical.length > 1) {
    return { error: `existen asignaciones canónicas duplicadas de ${name}` };
  }
  const all = propertyDirectives(gradleStatements(effectiveSource), name);
  if (all.length !== 1 || all[0].path !== name) {
    return { error: `${name} tiene overrides o sintaxis no canónica fuera de su bloque esperado` };
  }
  const value = parseValue(canonical[0]);
  if (value === undefined) {
    return { error: `${name} no usa un literal canónico soportado` };
  }
  return { value };
}

function namedContainerPropertyTargets(owner, targetName, propertyName) {
  return [
    ...propertyTargetSuffixes([owner, targetName], propertyName),
    ...[...NAMED_CONTAINER_METHODS].flatMap((accessor) =>
      propertyTargetSuffixes([owner, accessor, targetName], propertyName)),
  ];
}

function releaseIdentityMutationError(gradle) {
  const releaseBuild = canonicalReleaseBuildBlocks(gradle);
  if (releaseBuild.error) return releaseBuild.error;
  if (hasNamedAccessor(gradle.effectiveSource, 'buildTypes', 'release') ||
      hasNamedAccessor(releaseBuild.buildTypesSource, 'buildTypes', 'release', true)) {
    return 'android.buildTypes.release usa un accessor dinámico no canónico';
  }

  const releaseSuffixes = propertyDirectives(
    gradleStatements(releaseBuild.releaseBuildSource),
    'applicationIdSuffix',
  );
  if (releaseSuffixes.length > 0) {
    return 'android.buildTypes.release no admite applicationIdSuffix';
  }

  const releaseTargets = namedContainerPropertyTargets('buildTypes', 'release', 'applicationIdSuffix');
  const scopedReleaseTargets = releaseTargets.map((target) => target.slice(1));
  if (hasTargetedMutation(gradle.effectiveSource, releaseTargets) ||
      hasTargetedMutation(releaseBuild.buildTypesSource, scopedReleaseTargets)) {
    return 'applicationIdSuffix de release usa un override no canónico';
  }

  const productFlavors = namedBlocks(gradle.androidSource, 'productFlavors');
  const flavorIdentityProperties = ['applicationId', 'applicationIdSuffix'];
  const flavorIdentityProperty = flavorIdentityProperties.find((property) =>
    productFlavors.some((source) =>
      propertyDirectives(gradleStatements(source), property).length > 0));
  if (flavorIdentityProperty) {
    return `productFlavors con ${flavorIdentityProperty} no está soportado por el release gate`;
  }

  if (hasAnyNamedAccessor(gradle.effectiveSource, 'productFlavors') ||
      productFlavors.some((source) =>
        hasAnyNamedAccessor(source, 'productFlavors', true))) {
    return 'productFlavors usa un accessor dinámico no canónico que puede modificar la identidad';
  }

  const externalFlavorIdentityProperty = flavorIdentityProperties.find((property) =>
    propertyDirectives(gradleStatements(gradle.effectiveSource), property)
      .some(({ segments, expression }) =>
        Boolean(expression) && segments.includes('productFlavors')));
  return externalFlavorIdentityProperty
    ? `${externalFlavorIdentityProperty} de productFlavors usa un override no canónico`
    : undefined;
}

export function evaluateReleaseDebuggable(appBuild) {
  const gradle = canonicalAndroidBlocks(appBuild);
  if (gradle.error) {
    return entry(READINESS_STATUS.technicalBlocker, 'release debuggable', gradle.error);
  }
  const releaseBuild = canonicalReleaseBuildBlocks(gradle);
  if (releaseBuild.error) {
    return entry(READINESS_STATUS.technicalBlocker, 'release debuggable', releaseBuild.error);
  }
  if (hasNamedAccessor(gradle.effectiveSource, 'buildTypes', 'release') ||
      hasNamedAccessor(releaseBuild.buildTypesSource, 'buildTypes', 'release', true)) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'release debuggable',
      'buildTypes.release usa un accessor dinámico no canónico',
    );
  }

  const releaseTargets = namedContainerPropertyTargets('buildTypes', 'release', 'debuggable');
  const scopedReleaseTargets = releaseTargets.map((target) => target.slice(1));
  if (hasTargetedMutation(gradle.effectiveSource, releaseTargets) ||
      hasTargetedMutation(releaseBuild.buildTypesSource, scopedReleaseTargets)) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'release debuggable',
      'debuggable de release usa un override fuera del bloque canónico',
    );
  }

  const assignments = directPropertyAssignments(releaseBuild.releaseBuildSource, 'debuggable');
  const directives = propertyDirectives(
    gradleStatements(releaseBuild.releaseBuildSource),
    'debuggable',
  );
  if (assignments.length === 0 && directives.length === 0) {
    return entry(READINESS_STATUS.ready, 'release debuggable', 'release no habilita debuggable');
  }
  if (assignments.length !== 1 || directives.length !== 1 || directives[0].path !== 'debuggable') {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'release debuggable',
      'debuggable de release tiene asignaciones duplicadas o no canónicas',
    );
  }
  if (assignments[0] !== 'true' && assignments[0] !== 'false') {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'release debuggable',
      'debuggable de release no usa un booleano literal canónico',
    );
  }
  return assignments[0] === 'true'
    ? entry(READINESS_STATUS.technicalBlocker, 'release debuggable', 'release habilita debuggable')
    : entry(READINESS_STATUS.ready, 'release debuggable', 'release declara debuggable=false');
}

function signingAssignments(source, name) {
  const directive = new RegExp(`^${name}\\b\\s*(?:=\\s*)?([\\s\\S]+)$`);
  return directGradleStatements(source)
    .map((statement) => directive.exec(statement)?.[1]?.trim())
    .filter((value) => value !== undefined);
}

function hasPathSuffix(segments, suffix) {
  return segments.length >= suffix.length &&
    suffix.every((part, index) => segments[segments.length - suffix.length + index] === part);
}

function propertyTargetSuffixes(prefix, name) {
  const setter = `set${name[0].toUpperCase()}${name.slice(1)}`;
  return [
    [...prefix, name],
    [...prefix, 'properties', name],
    [...prefix, setter],
    [...prefix, name, 'set'],
  ];
}

function hasTargetedMutation(source, targetSuffixes) {
  return gradleStatements(source).some((statement) => {
    const directive = leadingGradlePath(statement);
    return Boolean(directive?.expression) &&
      targetSuffixes.some((suffix) => hasPathSuffix(directive.segments, suffix));
  });
}

function hasNamedAccessor(source, owner, targetName, allowScoped = false) {
  return gradleStatements(source).some((statement) => {
    const accessors = leadingGradlePath(statement)?.namedAccessors ?? [];
    return accessors.some((accessor) =>
      (accessor.owner === owner || (allowScoped && accessor.owner === undefined)) &&
      (accessor.target === targetName || accessor.target === undefined));
  });
}

function hasAnyNamedAccessor(source, owner, allowScoped = false) {
  return gradleStatements(source).some((statement) => {
    const accessors = leadingGradlePath(statement)?.namedAccessors ?? [];
    return accessors.some((accessor) =>
      accessor.owner === owner || (allowScoped && accessor.owner === undefined));
  });
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
  const gradle = canonicalAndroidBlocks(appBuild);
  if (gradle.error) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', gradle.error);
  }
  const { effectiveSource, androidSource } = gradle;
  if (hasNamedAccessor(effectiveSource, 'signingConfigs', 'release')) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'release signing',
      'signingConfigs.release usa un accessor dinámico no canónico',
    );
  }
  if (hasNamedAccessor(effectiveSource, 'buildTypes', 'release')) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'release signing',
      'buildTypes.release usa un accessor dinámico no canónico',
    );
  }
  const signingConfigs = namedBlocks(androidSource, 'signingConfigs');
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
  if (hasNamedAccessor(signingConfigs[0], 'signingConfigs', 'release', true)) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'release signing',
      'signingConfigs.release usa un accessor dinámico no canónico',
    );
  }

  const releaseBuild = canonicalReleaseBuildBlocks(gradle);
  if (releaseBuild.error) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', releaseBuild.error);
  }
  if (hasNamedAccessor(releaseBuild.buildTypesSource, 'buildTypes', 'release', true)) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'release signing',
      'buildTypes.release usa un accessor dinámico no canónico',
    );
  }
  const signingConfigAssignments = signingAssignments(releaseBuild.releaseBuildSource, 'signingConfig');
  if (signingConfigAssignments.length === 0) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'buildTypes.release no usa signingConfigs.release');
  }
  if (signingConfigAssignments.length > 1) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'buildTypes.release tiene asignaciones signingConfig duplicadas');
  }
  if (propertyDirectives(gradleStatements(releaseBuild.releaseBuildSource), 'signingConfig').length >
      signingConfigAssignments.length) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'buildTypes.release tiene asignaciones signingConfig duplicadas o no canónicas');
  }
  if (signingConfigAssignments[0] !== 'signingConfigs.release') {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', 'buildTypes.release no apunta exclusivamente a signingConfigs.release');
  }

  const signingFields = ['storeFile', 'storePassword', 'keyAlias', 'keyPassword'];
  const signingFieldTargets = signingFields.flatMap((field) => {
    const setter = `set${field[0].toUpperCase()}${field.slice(1)}`;
    return [
      ['signingConfigs', 'release', field],
      ['signingConfigs', 'release', 'properties', field],
      ['signingConfigs', 'release', setter],
      ['signingConfigs', 'release', field, 'set'],
    ];
  });
  const scopedSigningFieldTargets = signingFieldTargets.map((target) => target.slice(1));
  if (hasTargetedMutation(effectiveSource, signingFieldTargets) ||
      hasTargetedMutation(signingConfigs[0], scopedSigningFieldTargets)) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'release signing',
      'release signing tiene overrides fuera del bloque canónico',
    );
  }

  const buildTypeSigningTargets = [
    ['buildTypes', 'release', 'signingConfig'],
    ['buildTypes', 'release', 'properties', 'signingConfig'],
    ['buildTypes', 'release', 'setSigningConfig'],
    ['buildTypes', 'release', 'signingConfig', 'set'],
  ];
  const scopedBuildTypeSigningTargets = buildTypeSigningTargets.map((target) => target.slice(1));
  if (hasTargetedMutation(effectiveSource, buildTypeSigningTargets) ||
      hasTargetedMutation(releaseBuild.buildTypesSource, scopedBuildTypeSigningTargets)) {
    return entry(
      READINESS_STATUS.technicalBlocker,
      'release signing',
      'buildTypes.release.signingConfig tiene overrides fuera del bloque canónico',
    );
  }

  const assignments = Object.fromEntries(['storeFile', 'storePassword', 'keyAlias', 'keyPassword']
    .map((name) => [name, signingAssignments(releaseSigning[0], name)]));
  const missing = Object.entries(assignments).filter(([, values]) => values.length === 0).map(([name]) => name);
  if (missing.length) {
    return entry(READINESS_STATUS.technicalBlocker, 'release signing', `faltan campos: ${missing.join(', ')}`);
  }
  const duplicated = Object.entries(assignments).filter(([name, values]) =>
    values.length > 1 ||
    propertyDirectives(gradleStatements(releaseSigning[0]), name).length > values.length)
    .map(([name]) => name);
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
    evaluateReleaseDebuggable(inputs.appBuild),
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
