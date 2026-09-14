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

test('probe Gradle inspecciona la variante release real sin construir el artefacto', {
  timeout: 120_000,
}, async () => {
  const appBuild = await readFile(appBuildPath, 'utf8');
  const signingContract = inspectReleaseSigningSource(appBuild);
  const report = await runGradleReleaseProbe({ frontRoot, signingContract });

  assert.equal(report.projectPath, ':app');
  assert.equal(report.variants.length, 1);
  const [release] = report.variants;
  assert.equal(release.name, 'release');
  assert.equal(release.buildType, 'release');
  assert.equal(release.applicationId, 'com.example.app');
  assert.equal(release.namespace, 'com.example.app');
  assert.equal(release.debuggable, false);
  assert.deepEqual(release.outputs, [{
    enabled: true,
    versionCode: 1,
    versionName: '1.0',
  }]);
  assert.equal(release.signing.selectedName, null);
  assert.equal(release.signing.effectiveSelectionMatchesCanonicalMarker, false);
  assert.equal(release.signing.fields.storePassword.present, false);
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

  assert.equal(report.variants.length, 1);
  const signing = report.variants[0].signing;
  assertCanonicalSyntheticSigning(signing);
  for (const field of signingFields) {
    assert.equal(signing.fields[field].matchesSentinel, true, `${field} debe coincidir`);
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

  assert.equal(report.variants.length, 1);
  const signing = report.variants[0].signing;
  assertCanonicalSyntheticSigning(signing);
  assert.equal(signing.fields.storePassword.matchesSentinel, false);
  for (const field of signingFields.filter((name) => name !== 'storePassword')) {
    assert.equal(signing.fields[field].matchesSentinel, true, `${field} debe coincidir`);
  }
  assert.equal(JSON.stringify(report).includes('synthetic-test-override'), false);
});
