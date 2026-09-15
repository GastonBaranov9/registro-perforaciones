import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runGradleReleaseProbe } from './native-gradle-release-probe.mjs';
import { inspectReleaseSigningSource } from './native-release-readiness.mjs';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const appBuildPath = join(frontRoot, 'android/app/build.gradle');
const generatedEnvironmentPath = join(
  frontRoot,
  'src/environments/environment.native.generated.ts',
);
const signingFields = ['storeFile', 'storePassword', 'keyAlias', 'keyPassword'];
const syntheticSources = {
  storeFile: { kind: 'environment', name: 'RSP_TEST_STORE_FILE' },
  storePassword: { kind: 'environment', name: 'RSP_TEST_STORE_PASSWORD' },
  keyAlias: { kind: 'environment', name: 'RSP_TEST_KEY_ALIAS' },
  keyPassword: { kind: 'environment', name: 'RSP_TEST_KEY_PASSWORD' },
};
const syntheticSigningContract = {
  fields: syntheticSources,
  probeSources: Object.entries(syntheticSources).map(([field, source]) => ({
    field,
    ...source,
  })),
};

function syntheticSigningFixture({ overrideStorePassword = false } = {}) {
  return `
gradle.beforeProject { project ->
  if (project.path == ':app') {
    project.pluginManager.withPlugin('com.android.application') {
      def android = project.extensions.getByName('android')
      def releaseSigning = android.signingConfigs.maybeCreate('release')
      releaseSigning.storeFile = project.file(
        project.providers.environmentVariable('RSP_TEST_STORE_FILE').get()
      )
      releaseSigning.storePassword = project.providers
        .environmentVariable('RSP_TEST_STORE_PASSWORD').get()
      releaseSigning.keyAlias = project.providers
        .environmentVariable('RSP_TEST_KEY_ALIAS').get()
      releaseSigning.keyPassword = project.providers
        .environmentVariable('RSP_TEST_KEY_PASSWORD').get()
      ${overrideStorePassword
        ? "releaseSigning.storePassword = 'synthetic-test-override'"
        : ''}
      android.buildTypes.getByName('release').signingConfig = releaseSigning
    }
  }
}
`;
}

async function snapshot(path) {
  try {
    return { exists: true, contents: await readFile(path) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false };
    throw error;
  }
}

async function preserveRepositoryFiles(testContext) {
  const before = new Map(await Promise.all(
    [appBuildPath, generatedEnvironmentPath].map(async (path) => [path, await snapshot(path)]),
  ));
  testContext.after(async () => {
    for (const [path, expected] of before) {
      assert.deepEqual(await snapshot(path), expected, `${path} cambió durante el probe`);
    }
  });
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
  const report = await runGradleReleaseProbe({ frontRoot, signingContract });

  assertReportSchema(report);
});

test('probe Gradle atestigua signing release sintético y sus cuatro sentinels', {
  timeout: 120_000,
}, async (testContext) => {
  await preserveRepositoryFiles(testContext);
  const report = await runGradleReleaseProbe({
    frontRoot,
    signingContract: syntheticSigningContract,
    testFixtureInitScript: syntheticSigningFixture(),
  });

  assertReportSchema(report);
  assert.ok(report.variants.length > 0, 'la fixture debe producir variantes release');
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
  await preserveRepositoryFiles(testContext);
  const report = await runGradleReleaseProbe({
    frontRoot,
    signingContract: syntheticSigningContract,
    testFixtureInitScript: syntheticSigningFixture({ overrideStorePassword: true }),
  });

  assertReportSchema(report);
  assert.ok(report.variants.length > 0, 'la fixture debe producir variantes release');
  for (const variant of report.variants) {
    assertCanonicalSyntheticSigning(variant.signing);
    assert.equal(variant.signing.fields.storePassword.matchesSentinel, false);
    for (const field of signingFields.filter((name) => name !== 'storePassword')) {
      assert.equal(variant.signing.fields[field].matchesSentinel, true, `${field} debe coincidir`);
    }
  }
  assert.equal(JSON.stringify(report).includes('synthetic-test-override'), false);
});

test('probe transporta sentinels de signing solo por environment', async () => {
  const source = await readFile(new URL('./native-gradle-release-probe.mjs', import.meta.url), 'utf8');
  assert.match(source, /environment\[source\.name\] = value/);
  assert.doesNotMatch(source, /gradleProperties/);
  assert.doesNotMatch(source, /['"\x60]-P/);
});
