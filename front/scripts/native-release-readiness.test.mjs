import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateAndroidIdentity,
  evaluateNativeReleaseReadiness,
  evaluateReleaseSigning,
  evaluateVersion,
  READINESS_STATUS,
  stripGradleComments,
} from './native-release-readiness.mjs';

function identityFixture(appId = 'uy.com.empresa.perforaciones', appName = 'Perforaciones') {
  return {
    capacitor: `appId: '${appId}',\nappName: '${appName}',`,
    strings: `<resources>
      <string name="app_name">${appName}</string>
      <string name="title_activity_main">${appName}</string>
      <string name="package_name">${appId}</string>
      <string name="custom_url_scheme">${appId}</string>
    </resources>`,
    mainActivities: [{
      relativePath: `${appId.replaceAll('.', '/')}/MainActivity.java`,
      source: `package ${appId};\npublic class MainActivity extends BridgeActivity {}`,
    }],
  };
}

const envSigning = `
  signingConfigs {
    release {
      storeFile file(providers.environmentVariable("ANDROID_STORE_FILE").get())
      storePassword providers.environmentVariable("ANDROID_STORE_PASSWORD").get()
      keyAlias providers.gradleProperty("ANDROID_KEY_ALIAS").get()
      keyPassword System.getenv("ANDROID_KEY_PASSWORD")
    }
  }
`;

function appBuildFixture(appId = 'uy.com.empresa.perforaciones', signing = envSigning) {
  return `android {
    namespace "${appId}"
    defaultConfig {
      applicationId "${appId}"
      versionCode 7
      versionName "1.2.3"
    }
    ${signing}
    buildTypes {
      release {
        signingConfig signingConfigs.release
        minifyEnabled false
      }
    }
  }`;
}

test('identidad coherente acepta packages finales distintos sin fijar su valor', () => {
  for (const appId of ['uy.com.empresa.perforaciones', 'com.organizacion.registro_app']) {
    const identity = identityFixture(appId);
    const result = evaluateAndroidIdentity({ ...identity, appBuild: appBuildFixture(appId) });
    assert.equal(result.status, READINESS_STATUS.ready, result.detail);
    assert.equal(result.coherent, true);
  }
});

test('identidad inconsistente bloquea y el placeholder coherente requiere decisión', () => {
  const finalIdentity = identityFixture();
  const mismatch = evaluateAndroidIdentity({
    ...finalIdentity,
    appBuild: appBuildFixture('com.organizacion.otro'),
  });
  assert.equal(mismatch.status, READINESS_STATUS.technicalBlocker);

  const placeholder = identityFixture('com.example.app', 'front');
  const current = evaluateAndroidIdentity({
    ...placeholder,
    appBuild: appBuildFixture('com.example.app', ''),
  });
  assert.equal(current.status, READINESS_STATUS.humanDecision);
  assert.equal(current.coherent, true);
});

test('versionado válido pasa y valores ausentes o inválidos bloquean', () => {
  assert.equal(evaluateVersion('versionCode 1\nversionName "1.0"').status, READINESS_STATUS.ready);
  for (const source of [
    'versionCode 0\nversionName "1.0"',
    'versionCode -1\nversionName "1.0"',
    'versionCode 1\nversionName ""',
    'versionCode 1',
  ]) {
    assert.equal(evaluateVersion(source).status, READINESS_STATUS.technicalBlocker);
  }
});

test('signing distingue unsigned, debug, secretos hardcodeados y providers seguros', () => {
  const unsigned = appBuildFixture(undefined, '');
  assert.equal(evaluateReleaseSigning(unsigned).status, READINESS_STATUS.technicalBlocker);

  const debugSigning = appBuildFixture().replace('signingConfigs.release\n        minifyEnabled', 'signingConfigs.debug\n        minifyEnabled');
  assert.equal(evaluateReleaseSigning(debugSigning).status, READINESS_STATUS.technicalBlocker);

  const hardcoded = appBuildFixture().replace(
    'providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    '"fixture-hardcoded-secret"',
  );
  assert.equal(evaluateReleaseSigning(hardcoded).status, READINESS_STATUS.technicalBlocker);

  const hardcodedStorePath = appBuildFixture().replace(
    'file(providers.environmentVariable("ANDROID_STORE_FILE").get())',
    'file("fixture-release.jks")',
  );
  assert.equal(evaluateReleaseSigning(hardcodedStorePath).status, READINESS_STATUS.technicalBlocker);

  const hardcodedAlias = appBuildFixture().replace(
    'providers.gradleProperty("ANDROID_KEY_ALIAS").get()',
    '"fixture-hardcoded-alias"',
  );
  assert.equal(evaluateReleaseSigning(hardcodedAlias).status, READINESS_STATUS.technicalBlocker);

  const hardcodedFallback = appBuildFixture().replace(
    'providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    'providers.environmentVariable("ANDROID_STORE_PASSWORD").orElse("fixture-hardcoded-fallback").get()',
  );
  assert.equal(evaluateReleaseSigning(hardcodedFallback).status, READINESS_STATUS.technicalBlocker);

  const nullableProvider = appBuildFixture().replace(
    'providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    'providers.environmentVariable("ANDROID_STORE_PASSWORD").orNull',
  );
  assert.equal(evaluateReleaseSigning(nullableProvider).status, READINESS_STATUS.technicalBlocker);

  assert.equal(
    evaluateReleaseSigning(appBuildFixture()).status,
    READINESS_STATUS.ready,
  );
});

test('signing considera sólo directivas efectivas y preserva marcadores dentro de strings', () => {
  const commentedLink = appBuildFixture().replace(
    'signingConfig signingConfigs.release',
    '// signingConfig signingConfigs.release',
  );
  assert.equal(evaluateReleaseSigning(commentedLink).status, READINESS_STATUS.technicalBlocker);

  const blockCommentedLink = appBuildFixture().replace(
    'signingConfig signingConfigs.release',
    '/*\n        signingConfig signingConfigs.release\n        */',
  );
  assert.equal(evaluateReleaseSigning(blockCommentedLink).status, READINESS_STATUS.technicalBlocker);

  const commentedSafeThenHardcoded = appBuildFixture().replace(
    'storePassword providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    '// storePassword providers.environmentVariable("SAFE").get()\n      storePassword "hardcoded-secret"',
  );
  assert.equal(
    evaluateReleaseSigning(commentedSafeThenHardcoded).status,
    READINESS_STATUS.technicalBlocker,
  );

  const commentedHardcodedThenSafe = appBuildFixture().replace(
    'storePassword providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    '// storePassword "hardcoded"\n      storePassword providers.environmentVariable("SAFE").get()',
  );
  assert.equal(evaluateReleaseSigning(commentedHardcodedThenSafe).status, READINESS_STATUS.ready);

  const urlInsideString = appBuildFixture().replace(
    'storePassword providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    'def endpoint = "https://example.com/a//b"; storePassword providers.environmentVariable("SAFE").get()',
  );
  assert.equal(evaluateReleaseSigning(urlInsideString).status, READINESS_STATUS.ready);
  assert.match(stripGradleComments('def endpoint = "https://example.com/a//b" // quitar'), /https:\/\/example\.com\/a\/\/b/);
  const escapedString = String.raw`def endpoint = "https://example.com/a//b/\"quoted\"" // quitar`;
  const normalizedEscapedString = stripGradleComments(escapedString);
  assert.ok(normalizedEscapedString.includes(String.raw`"https://example.com/a//b/\"quoted\""`));
  assert.doesNotMatch(normalizedEscapedString, /quitar/);
});

test('signing bloquea campos efectivos duplicados sin decidir precedencia Groovy', () => {
  const safeThenHardcoded = appBuildFixture().replace(
    'storePassword providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    'storePassword providers.environmentVariable("SAFE").get()\n      storePassword "hardcoded-secret"',
  );
  const hardcodedThenSafe = appBuildFixture().replace(
    'storePassword providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    'storePassword "hardcoded-secret"\n      storePassword providers.environmentVariable("SAFE").get()',
  );
  const conditionalDuplicate = appBuildFixture().replace(
    'storePassword providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    'storePassword providers.environmentVariable("SAFE").get()\n      if (true) { storePassword "hardcoded-secret" }',
  );
  for (const appBuild of [safeThenHardcoded, hardcodedThenSafe, conditionalDuplicate]) {
    const result = evaluateReleaseSigning(appBuild);
    assert.equal(result.status, READINESS_STATUS.technicalBlocker);
    assert.match(result.detail, /asignaciones duplicadas: storePassword/);
  }
});

test('signing bloquea enlaces efectivos duplicados en buildTypes.release', () => {
  const duplicateLink = appBuildFixture().replace(
    'signingConfig signingConfigs.release',
    'signingConfig signingConfigs.release\n        signingConfig signingConfigs.release',
  );
  const result = evaluateReleaseSigning(duplicateLink);
  assert.equal(result.status, READINESS_STATUS.technicalBlocker);
  assert.match(result.detail, /signingConfig duplicadas/);
});

test('signing rechaza una Map hardcodeada aunque nombres comunes estén protegidos por gitignore', () => {
  const hardcodedMapSigning = `
  def keystoreProperties = [
    storeFile: "release.jks",
    storePassword: "hardcoded-secret",
    keyAlias: "hardcoded-alias",
    keyPassword: "hardcoded-password"
  ]

  signingConfigs {
    release {
      storeFile file(keystoreProperties['storeFile'])
      storePassword keystoreProperties['storePassword']
      keyAlias keystoreProperties['keyAlias']
      keyPassword keystoreProperties['keyPassword']
    }
  }`;
  const result = evaluateReleaseSigning(appBuildFixture(undefined, hardcodedMapSigning));
  assert.equal(result.status, READINESS_STATUS.technicalBlocker);
  assert.match(result.detail, /storeFile, storePassword, keyAlias, keyPassword/);
});

test('preflight actual bloquea y una configuración futura estructuralmente válida llega a exit 0', () => {
  const placeholder = identityFixture('com.example.app', 'front');
  const blocked = evaluateNativeReleaseReadiness({
    ...placeholder,
    appBuild: appBuildFixture('com.example.app', ''),
    origin: undefined,
  });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.exitCode, 2);

  const finalIdentity = identityFixture();
  const ready = evaluateNativeReleaseReadiness({
    ...finalIdentity,
    appBuild: appBuildFixture(),
    origin: 'https://api.release-readiness.uy',
  });
  assert.equal(ready.blocked, false);
  assert.equal(ready.exitCode, 0);
  assert.ok(ready.entries.every(({ status }) =>
    status === READINESS_STATUS.ready || status === READINESS_STATUS.manualCheck));
});
