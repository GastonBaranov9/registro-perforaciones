import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runGradleReleaseProbe } from './native-gradle-release-probe.mjs';
import { inspectReleaseSigningSource } from './native-release-readiness.mjs';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const androidRoot = join(frontRoot, 'android');
const appBuildPath = join(frontRoot, 'android/app/build.gradle');
const signingFields = ['storeFile', 'storePassword', 'keyAlias', 'keyPassword'];

function requiredVersion(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `no se pudo derivar ${label} del proyecto Android real`);
  return match[1];
}

async function minimalLocalProperties() {
  if (process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME) return null;
  let source;
  try {
    source = await readFile(join(androidRoot, 'local.properties'), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      assert.fail('falta ANDROID_SDK_ROOT/ANDROID_HOME y android/local.properties con sdk.dir');
    }
    throw error;
  }
  const sdkDir = source.match(/^\s*sdk\.dir\s*=\s*(.+?)\s*$/m)?.[1];
  assert.ok(sdkDir, 'android/local.properties no contiene sdk.dir');
  return `sdk.dir=${sdkDir}\n`;
}

async function createSyntheticAndroidProject(testContext, {
  overrideStorePassword = false,
} = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'rsp-native-gradle-fixture-'));
  let realAppBuildBefore;
  testContext.after(async () => {
    try {
      if (realAppBuildBefore !== undefined) {
        assert.deepEqual(
          await readFile(appBuildPath),
          realAppBuildBefore,
          'la fixture sintética no debe modificar android/app/build.gradle',
        );
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
  realAppBuildBefore = await readFile(appBuildPath);

  const [rootBuild, variables, localProperties] = await Promise.all([
    readFile(join(androidRoot, 'build.gradle'), 'utf8'),
    readFile(join(androidRoot, 'variables.gradle'), 'utf8'),
    minimalLocalProperties(),
  ]);
  const agpVersion = requiredVersion(
    rootBuild,
    /com\.android\.tools\.build:gradle:([^'"\s]+)/,
    'la versión AGP',
  );
  const compileSdk = requiredVersion(variables, /compileSdkVersion\s*=\s*(\d+)/, 'compileSdk');
  const minSdk = requiredVersion(variables, /minSdkVersion\s*=\s*(\d+)/, 'minSdk');
  const targetSdk = requiredVersion(variables, /targetSdkVersion\s*=\s*(\d+)/, 'targetSdk');
  const storePasswordOverride = overrideStorePassword
    ? "storePassword = 'synthetic-test-override'"
    : '';
  const appBuild = `
apply plugin: 'com.android.application'

android {
  namespace 'uy.test.rsp.releaseprobe'
  compileSdk ${compileSdk}

  defaultConfig {
    applicationId 'uy.test.rsp.releaseprobe'
    minSdk ${minSdk}
    targetSdk ${targetSdk}
    versionCode 9001
    versionName '9.0.1-test'
  }

  signingConfigs {
    release {
      storeFile file(providers.environmentVariable('RSP_TEST_STORE_FILE').get())
      storePassword providers.environmentVariable('RSP_TEST_STORE_PASSWORD').get()
      keyAlias providers.environmentVariable('RSP_TEST_KEY_ALIAS').get()
      keyPassword providers.environmentVariable('RSP_TEST_KEY_PASSWORD').get()
      ${storePasswordOverride}
    }
  }

  buildTypes {
    release {
      signingConfig signingConfigs.release
    }
  }
}
`;

  await mkdir(join(projectRoot, 'app'));
  await Promise.all([
    writeFile(
      join(projectRoot, 'settings.gradle'),
      "rootProject.name = 'rsp-release-probe-fixture'\ninclude ':app'\n",
      'utf8',
    ),
    writeFile(join(projectRoot, 'build.gradle'), `
buildscript {
  repositories {
    google()
    mavenCentral()
  }
  dependencies {
    classpath 'com.android.tools.build:gradle:${agpVersion}'
  }
}

allprojects {
  repositories {
    google()
    mavenCentral()
  }
}
`, 'utf8'),
    writeFile(join(projectRoot, 'app/build.gradle'), appBuild, 'utf8'),
    ...(localProperties === null
      ? []
      : [writeFile(join(projectRoot, 'local.properties'), localProperties, 'utf8')]),
  ]);

  const signingContract = inspectReleaseSigningSource(
    overrideStorePassword ? appBuild.replace(storePasswordOverride, '') : appBuild,
  );
  assert.equal(signingContract.error, undefined);
  return { projectRoot, signingContract };
}

function assertCanonicalSyntheticSigning(signing) {
  assert.equal(signing.selectedName, 'release');
  assert.equal(signing.selectedIsCanonicalRelease, true);
  assert.equal(signing.effectiveSelectionMatchesCanonicalMarker, true);
  assert.equal(signing.selectionUnambiguous, true);
  for (const field of signingFields) {
    assert.equal(signing.fields[field].present, true, `${field} debe estar presente`);
  }
}

function assertSanitizedSyntheticReport(report) {
  assert.doesNotMatch(
    JSON.stringify(report),
    /RSP_(?:PROBE|TEST)_|synthetic-test-override/,
    'el reporte no debe revelar sentinels, nombres de variables ni overrides',
  );
}

function assertOptionalString(value, name) {
  assert.ok(value === null || typeof value === 'string', `${name} debe ser string o null`);
}

function assertSanitizedSigning(signing) {
  assert.deepEqual(Object.keys(signing).sort(), [
    'effectiveSelectionMatchesCanonicalMarker',
    'fields',
    'selectedIsCanonicalRelease',
    'selectedName',
    'selectionUnambiguous',
  ]);
  assertOptionalString(signing.selectedName, 'signing.selectedName');
  assert.equal(typeof signing.selectedIsCanonicalRelease, 'boolean');
  assert.equal(typeof signing.effectiveSelectionMatchesCanonicalMarker, 'boolean');
  assert.equal(typeof signing.selectionUnambiguous, 'boolean');
  assert.deepEqual(Object.keys(signing.fields).sort(), [...signingFields].sort());
  for (const field of signingFields) {
    assert.deepEqual(Object.keys(signing.fields[field]).sort(), ['matchesSentinel', 'present']);
    assert.equal(typeof signing.fields[field].present, 'boolean');
    assert.equal(typeof signing.fields[field].matchesSentinel, 'boolean');
  }
}

function assertReleaseVariantSchema(variant) {
  assert.deepEqual(Object.keys(variant).sort(), [
    'applicationId',
    'buildType',
    'debuggable',
    'name',
    'namespace',
    'outputs',
    'productFlavors',
    'signing',
  ]);
  assert.match(variant.name, /^[A-Za-z][A-Za-z0-9_]*$/);
  assert.equal(variant.buildType, 'release');
  assert.ok(Array.isArray(variant.productFlavors));
  for (const flavor of variant.productFlavors) {
    assert.deepEqual(Object.keys(flavor).sort(), ['dimension', 'name']);
    assert.equal(typeof flavor.dimension, 'string');
    assert.equal(typeof flavor.name, 'string');
  }
  assertOptionalString(variant.applicationId, 'applicationId');
  assertOptionalString(variant.namespace, 'namespace');
  assert.equal(typeof variant.debuggable, 'boolean');
  assert.ok(Array.isArray(variant.outputs));
  for (const output of variant.outputs) {
    assert.deepEqual(Object.keys(output).sort(), ['enabled', 'versionCode', 'versionName']);
    assert.equal(typeof output.enabled, 'boolean');
    assert.ok(output.versionCode === null || Number.isSafeInteger(output.versionCode));
    assertOptionalString(output.versionName, 'output.versionName');
  }
  assertSanitizedSigning(variant.signing);
}

function assertReportSchema(report) {
  assert.deepEqual(Object.keys(report).sort(), ['projectPath', 'schemaVersion', 'variants']);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.projectPath, ':app');
  assert.ok(Array.isArray(report.variants));
  for (const variant of report.variants) assertReleaseVariantSchema(variant);
}

test('probe Gradle inspecciona la variante release real sin construir el artefacto', {
  timeout: 120_000,
}, async () => {
  const appBuild = await readFile(appBuildPath, 'utf8');
  const signingContract = inspectReleaseSigningSource(appBuild);
  const report = await runGradleReleaseProbe({
    projectRoot: androidRoot,
    wrapperRoot: androidRoot,
    signingContract,
  });

  assertReportSchema(report);
});

test('probe Gradle atestigua signing release sintético y sus cuatro sentinels', {
  timeout: 120_000,
}, async (testContext) => {
  const fixture = await createSyntheticAndroidProject(testContext);
  const report = await runGradleReleaseProbe({
    projectRoot: fixture.projectRoot,
    wrapperRoot: androidRoot,
    signingContract: fixture.signingContract,
  });

  assertReportSchema(report);
  assertSanitizedSyntheticReport(report);
  assert.equal(report.variants.length, 1, 'la fixture debe producir una variante release utilizable');
  for (const variant of report.variants) {
    assertCanonicalSyntheticSigning(variant.signing);
    for (const field of signingFields) {
      assert.equal(variant.signing.fields[field].matchesSentinel, true, `${field} debe coincidir`);
    }
  }
});

test('probe Gradle detecta un override sintético posterior sin revelar su valor', {
  timeout: 120_000,
}, async (testContext) => {
  const fixture = await createSyntheticAndroidProject(testContext, {
    overrideStorePassword: true,
  });
  const report = await runGradleReleaseProbe({
    projectRoot: fixture.projectRoot,
    wrapperRoot: androidRoot,
    signingContract: fixture.signingContract,
  });

  assertReportSchema(report);
  assertSanitizedSyntheticReport(report);
  assert.equal(report.variants.length, 1, 'la fixture debe producir una variante release utilizable');
  for (const variant of report.variants) {
    assertCanonicalSyntheticSigning(variant.signing);
    assert.equal(variant.signing.fields.storePassword.matchesSentinel, false);
    for (const field of signingFields.filter((name) => name !== 'storePassword')) {
      assert.equal(variant.signing.fields[field].matchesSentinel, true, `${field} debe coincidir`);
    }
  }
});

test('probe transporta sentinels de signing solo por environment', async () => {
  const source = await readFile(new URL('./native-gradle-release-probe.mjs', import.meta.url), 'utf8');
  assert.match(source, /environment\[source\.name\] = value/);
  assert.doesNotMatch(source, /gradleProperties/);
  assert.doesNotMatch(source, /['"\x60]-P/);
});
