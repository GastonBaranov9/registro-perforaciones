import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateAndroidIdentity,
  evaluateNativeReleaseReadiness,
  evaluateReleaseSigning,
  evaluateVersion,
  READINESS_STATUS,
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
    origin: 'https://api.perforaciones.invalid',
  });
  assert.equal(ready.blocked, false);
  assert.equal(ready.exitCode, 0);
  assert.ok(ready.entries.every(({ status }) =>
    status === READINESS_STATUS.ready || status === READINESS_STATUS.manualCheck));
});
