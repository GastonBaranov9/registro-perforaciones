import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateAndroidIdentity,
  evaluateNativeReleaseReadiness,
  evaluateReleaseDebuggable,
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

function withReleaseDirective(appBuild, directive) {
  return appBuild.replace(
    '        signingConfig signingConfigs.release',
    `        ${directive}\n        signingConfig signingConfigs.release`,
  );
}

function withDefaultConfigDirective(appBuild, directive) {
  return appBuild.replace(
    '      versionCode 7',
    `      ${directive}\n      versionCode 7`,
  );
}

function withBuildTypesDirective(appBuild, directive) {
  const androidEnd = appBuild.lastIndexOf('}');
  const buildTypesEnd = appBuild.lastIndexOf('}', androidEnd - 1);
  return `${appBuild.slice(0, buildTypesEnd)}  ${directive}\n    ${appBuild.slice(buildTypesEnd)}`;
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

test('identidad Gradle usa solo asignaciones efectivas canonicas', () => {
  const appId = 'uy.com.empresa.perforaciones';
  const identity = identityFixture(appId);
  const commentedNamespace = appBuildFixture(appId).replace(
    `namespace "${appId}"`,
    `// namespace "uy.com.correcta"\n    namespace "${appId}"`,
  );
  const commentedApplicationId = appBuildFixture(appId).replace(
    `applicationId "${appId}"`,
    `// applicationId "uy.com.correcta"\n      applicationId "${appId}"`,
  );

  for (const appBuild of [commentedNamespace, commentedApplicationId]) {
    const result = evaluateAndroidIdentity({ ...identity, appBuild });
    assert.equal(result.status, READINESS_STATUS.ready, result.detail);
    assert.equal(result.appId, appId);
  }
});

test('identidad Gradle bloquea duplicados y overrides externos', () => {
  const appId = 'uy.com.empresa.perforaciones';
  const identity = identityFixture(appId);
  const duplicateNamespace = appBuildFixture(appId).replace(
    `namespace "${appId}"`,
    `namespace "uy.com.uno"\n    namespace "${appId}"`,
  );
  const duplicateApplicationId = appBuildFixture(appId).replace(
    `applicationId "${appId}"`,
    `applicationId "uy.com.uno"\n      applicationId "${appId}"`,
  );
  const externalApplicationId = `${appBuildFixture(appId)}\nandroid.defaultConfig.applicationId = "uy.com.otro"`;
  const externalNamespace = `${appBuildFixture(appId)}\nandroid.namespace = "uy.com.otro"`;
  const bracketApplicationId = `${appBuildFixture(appId)}\nandroid["defaultConfig"]["applicationId"] = "uy.com.otro"`;
  const setterNamespace = `${appBuildFixture(appId)}\nandroid.setNamespace("uy.com.otro")`;

  for (const appBuild of [
    duplicateNamespace,
    duplicateApplicationId,
    externalApplicationId,
    externalNamespace,
    bracketApplicationId,
    setterNamespace,
  ]) {
    const result = evaluateAndroidIdentity({ ...identity, appBuild });
    assert.equal(result.status, READINESS_STATUS.technicalBlocker);
  }

  const commentedOverride = `${appBuildFixture(appId)}\n// android.namespace = "uy.com.otro"`;
  assert.equal(
    evaluateAndroidIdentity({ ...identity, appBuild: commentedOverride }).status,
    READINESS_STATUS.ready,
  );
});

test('identidad y version exigen bloques Android canonicos unicos', () => {
  const appId = 'uy.com.empresa.perforaciones';
  const identity = identityFixture(appId);
  const duplicateAndroid = `${appBuildFixture(appId)}\n${appBuildFixture(appId)}`;
  const duplicateDefaultConfig = appBuildFixture(appId).replace(
    '      versionName "1.2.3"\n    }',
    '      versionName "1.2.3"\n    }\n    defaultConfig { applicationId "uy.com.otro"; versionCode 8; versionName "2.0" }',
  );
  for (const appBuild of [duplicateAndroid, duplicateDefaultConfig]) {
    assert.equal(
      evaluateAndroidIdentity({ ...identity, appBuild }).status,
      READINESS_STATUS.technicalBlocker,
    );
    assert.equal(evaluateVersion(appBuild).status, READINESS_STATUS.technicalBlocker);
  }
});

test('identidad y version bloquean bloques calificados o sintaxis Gradle incompleta', () => {
  const appId = 'uy.com.empresa.perforaciones';
  const identity = identityFixture(appId);
  const qualifiedAndroid = appBuildFixture(appId).replace(/^android/, 'holder.android');
  const qualifiedDefaultConfig = appBuildFixture(appId).replace('defaultConfig {', 'holder.defaultConfig {');
  const malformedSources = [
    `${appBuildFixture(appId)}\nandroid {`,
    `${appBuildFixture(appId)}\n/* comentario sin cierre`,
    appBuildFixture(appId).replace('versionName "1.2.3"', 'versionName "1.2.3"\n      helper('),
  ];

  for (const appBuild of [qualifiedAndroid, qualifiedDefaultConfig, ...malformedSources]) {
    assert.equal(
      evaluateAndroidIdentity({ ...identity, appBuild }).status,
      READINESS_STATUS.technicalBlocker,
    );
    assert.equal(evaluateVersion(appBuild).status, READINESS_STATUS.technicalBlocker);
  }
});

test('identidad release rechaza mutaciones de productFlavors y suffix salvo configuración exclusiva de debug', () => {
  const appId = 'uy.com.empresa.perforaciones';
  const identity = identityFixture(appId);
  const debugSuffix = appBuildFixture(appId).replace(
    '    buildTypes {\n      release {',
    '    buildTypes {\n      debug { applicationIdSuffix ".debug" }\n      release {',
  );
  const commentedSuffix = withReleaseDirective(
    appBuildFixture(appId),
    '// applicationIdSuffix ".fake"',
  );
  const commentedDefaultSuffix = withDefaultConfigDirective(
    appBuildFixture(appId),
    '// applicationIdSuffix ".fake"',
  );
  const commentedFlavorSuffix = appBuildFixture(appId).replace(
    '    buildTypes {',
    '    productFlavors {\n      demo { // applicationIdSuffix ".fake"\n        dimension "mode"\n      }\n    }\n    buildTypes {',
  );
  const commentedFlavorAccessors = `${appBuildFixture(appId)}
// android.productFlavors.getByName(flavorName).applicationIdSuffix = ".fake"
/* productFlavors.named("demo").applicationId = "uy.com.otro" */`;

  for (const appBuild of [
    debugSuffix,
    commentedSuffix,
    commentedDefaultSuffix,
    commentedFlavorSuffix,
    commentedFlavorAccessors,
    `${appBuildFixture(appId)}\nbuildTypes.getByName("debug").applicationIdSuffix = ".debug"`,
    `${appBuildFixture(appId)}\nandroid.defaultConfig.setProperty("minSdk", 24)`,
  ]) {
    const result = evaluateAndroidIdentity({ ...identity, appBuild });
    assert.equal(result.status, READINESS_STATUS.ready, result.detail);
  }

  const flavored = appBuildFixture(appId).replace(
    '    buildTypes {',
    '    productFlavors {\n      demo { applicationIdSuffix ".demo" }\n    }\n    buildTypes {',
  );
  const flavoredApplicationId = appBuildFixture(appId).replace(
    '    buildTypes {',
    '    productFlavors {\n      demo { applicationId "uy.com.otro" }\n    }\n    buildTypes {',
  );
  for (const appBuild of [
    withDefaultConfigDirective(appBuildFixture(appId), 'applicationIdSuffix ".x"'),
    withDefaultConfigDirective(appBuildFixture(appId), 'applicationIdSuffix = ".x"'),
    withDefaultConfigDirective(appBuildFixture(appId), 'applicationIdSuffix ""'),
    `${appBuildFixture(appId)}\nandroid.defaultConfig.applicationIdSuffix = ".x"`,
    `${appBuildFixture(appId)}\ndefaultConfig.applicationIdSuffix = ".x"`,
    `${appBuildFixture(appId)}\nandroid.defaultConfig["applicationIdSuffix"] = ".x"`,
    `${appBuildFixture(appId)}\nandroid.defaultConfig.setApplicationIdSuffix(".x")`,
    `${appBuildFixture(appId)}\nandroid.defaultConfig.setProperty("applicationIdSuffix", ".x")`,
    `${appBuildFixture(appId)}\nandroid.defaultConfig.setProperty(identityProperty, ".x")`,
    `${appBuildFixture(appId)}\nandroid.defaultConfig.setProperty("applicationId", "uy.com.otro")`,
    `${appBuildFixture(appId)}\nandroid.setProperty("namespace", "uy.com.otro")`,
    withDefaultConfigDirective(
      appBuildFixture(appId),
      'if (true) { setProperty("applicationIdSuffix", ".x") }',
    ),
    withReleaseDirective(appBuildFixture(appId), 'applicationIdSuffix ".prod"'),
    withReleaseDirective(appBuildFixture(appId), 'applicationIdSuffix = ".prod"'),
    withReleaseDirective(appBuildFixture(appId), 'applicationIdSuffix ""'),
    flavored,
    flavoredApplicationId,
    `${appBuildFixture(appId)}\nandroid.buildTypes.release.applicationIdSuffix = ".x"`,
    `${appBuildFixture(appId)}\nbuildTypes.getByName("release").applicationIdSuffix = ".x"`,
    `${appBuildFixture(appId)}\nandroid.productFlavors.getByName(flavorName).applicationIdSuffix = ".x"`,
    `${appBuildFixture(appId)}\nandroid.productFlavors.getByName(flavorName).applicationId = "uy.com.otro"`,
    `${appBuildFixture(appId)}\nproductFlavors.named("demo").applicationId = "uy.com.otro"`,
    withBuildTypesDirective(
      appBuildFixture(appId),
      'getByName("release") { applicationIdSuffix ".x" }',
    ),
  ]) {
    const result = evaluateAndroidIdentity({ ...identity, appBuild });
    assert.equal(result.status, READINESS_STATUS.technicalBlocker, result.detail);
  }
});

test('versionado válido pasa y valores ausentes o inválidos bloquean', () => {
  assert.equal(evaluateVersion(appBuildFixture()).status, READINESS_STATUS.ready);
  for (const source of [
    appBuildFixture().replace('versionCode 7', 'versionCode 0'),
    appBuildFixture().replace('versionCode 7', 'versionCode -1'),
    appBuildFixture().replace('versionName "1.2.3"', 'versionName ""'),
    appBuildFixture().replace('versionName "1.2.3"', 'versionName "${RELEASE_VERSION}"'),
    appBuildFixture().replace('versionName "1.2.3"', ''),
  ]) {
    assert.equal(evaluateVersion(source).status, READINESS_STATUS.technicalBlocker);
  }
});

test('versionado Gradle ignora comentarios y bloquea duplicados efectivos', () => {
  const commentedCode = appBuildFixture().replace(
    'versionCode 7',
    '// versionCode 100\n      versionCode 1',
  );
  const commentedName = appBuildFixture().replace(
    'versionName "1.2.3"',
    '// versionName "9.9"\n      versionName "1.0"',
  );
  assert.match(evaluateVersion(commentedCode).detail, /versionCode=1;/);
  assert.match(evaluateVersion(commentedName).detail, /versionName=1\.0/);

  const duplicateCode = appBuildFixture().replace(
    'versionCode 7',
    'versionCode 1\n      versionCode 2',
  );
  const duplicateName = appBuildFixture().replace(
    'versionName "1.2.3"',
    'versionName "1.0"\n      versionName "2.0"',
  );
  for (const source of [duplicateCode, duplicateName]) {
    assert.equal(evaluateVersion(source).status, READINESS_STATUS.technicalBlocker);
  }
});

test('versionado Gradle bloquea overrides externos pero no comentarios', () => {
  for (const override of [
    'android.defaultConfig.versionCode = 8',
    'defaultConfig.versionName = "2.0"',
    'android.defaultConfig["versionCode"] = 8',
    'android.defaultConfig.setVersionName("2.0")',
  ]) {
    assert.equal(
      evaluateVersion(`${appBuildFixture()}\n${override}`).status,
      READINESS_STATUS.technicalBlocker,
    );
  }
  assert.equal(
    evaluateVersion(`${appBuildFixture()}\n/* android.defaultConfig.versionCode = 8 */`).status,
    READINESS_STATUS.ready,
  );
});

test('versión release rechaza suffixes y overrides derivados de productFlavors', () => {
  const debugSuffix = appBuildFixture().replace(
    '    buildTypes {\n      release {',
    '    buildTypes {\n      debug { versionNameSuffix "-debug" }\n      release {',
  );
  for (const appBuild of [
    debugSuffix,
    `${appBuildFixture()}\nandroid.buildTypes.debug.versionNameSuffix = "-debug"`,
    `${appBuildFixture()}\nandroid.buildTypes.debug.setProperty("versionNameSuffix", "-debug")`,
    `${appBuildFixture()}\nandroid.defaultConfig.setProperty("minSdk", 24)`,
    withDefaultConfigDirective(appBuildFixture(), '// versionNameSuffix "-fake"'),
    withReleaseDirective(appBuildFixture(), '// versionNameSuffix "-fake"'),
    `${appBuildFixture()}\n// android.defaultConfig.setProperty("versionNameSuffix", "-fake")`,
  ]) {
    const result = evaluateVersion(appBuild);
    assert.equal(result.status, READINESS_STATUS.ready, result.detail);
  }

  const flavorMutation = (directive) => appBuildFixture().replace(
    '    buildTypes {',
    `    productFlavors {\n      demo { ${directive} }\n    }\n    buildTypes {`,
  );
  for (const appBuild of [
    withDefaultConfigDirective(appBuildFixture(), 'versionNameSuffix "-x"'),
    withDefaultConfigDirective(appBuildFixture(), 'versionNameSuffix = "-x"'),
    withDefaultConfigDirective(appBuildFixture(), 'versionNameSuffix ""'),
    `${appBuildFixture()}\nandroid.defaultConfig.versionNameSuffix = "-x"`,
    `${appBuildFixture()}\nandroid.defaultConfig.setVersionNameSuffix("-x")`,
    `${appBuildFixture()}\nandroid.defaultConfig.setProperty("versionNameSuffix", "-x")`,
    `${appBuildFixture()}\nandroid.defaultConfig.setProperty(versionProperty, "-x")`,
    `${appBuildFixture()}\nandroid.defaultConfig.setProperty("versionCode", 8)`,
    `${appBuildFixture()}\nandroid.defaultConfig.setProperty("versionName", "2.0")`,
    withDefaultConfigDirective(
      appBuildFixture(),
      'if (true) { setProperty("versionNameSuffix", "-x") }',
    ),
    withReleaseDirective(appBuildFixture(), 'versionNameSuffix "-prod"'),
    withReleaseDirective(appBuildFixture(), 'versionNameSuffix = "-prod"'),
    `${appBuildFixture()}\nandroid.buildTypes.release.versionNameSuffix = "-prod"`,
    `${appBuildFixture()}\nbuildTypes.getByName("release").versionNameSuffix = "-prod"`,
    flavorMutation('versionNameSuffix "-demo"'),
    flavorMutation('versionName "2.0"'),
    flavorMutation('versionCode 8'),
    `${appBuildFixture()}\nproductFlavors.named("demo").versionName = "2.0"`,
  ]) {
    const result = evaluateVersion(appBuild);
    assert.equal(result.status, READINESS_STATUS.technicalBlocker, result.detail);
  }
});

test('debuggable se evalúa sólo en buildTypes.release con sintaxis canónica', () => {
  const debugEnabled = appBuildFixture().replace(
    '    buildTypes {\n      release {',
    '    buildTypes {\n      debug { debuggable true }\n      release {',
  );
  for (const appBuild of [
    appBuildFixture(),
    debugEnabled,
    withReleaseDirective(appBuildFixture(), 'debuggable false'),
    withReleaseDirective(appBuildFixture(), 'debuggable = false'),
    withReleaseDirective(appBuildFixture(), '// debuggable true'),
    `${appBuildFixture()}\nbuildTypes.getByName("debug").debuggable = true`,
    `${appBuildFixture()}\nandroid.buildTypes.debug.setProperty("debuggable", true)`,
    `${appBuildFixture()}\nandroid.buildTypes.release.setProperty("minifyEnabled", false)`,
    `${appBuildFixture()}\n// android.buildTypes.release.setProperty("debuggable", true)`,
  ]) {
    const result = evaluateReleaseDebuggable(appBuild);
    assert.equal(result.status, READINESS_STATUS.ready, result.detail);
  }

  for (const appBuild of [
    withReleaseDirective(appBuildFixture(), 'debuggable true'),
    withReleaseDirective(appBuildFixture(), 'debuggable = true'),
    withReleaseDirective(appBuildFixture(), 'debuggable false\n        debuggable = false'),
    withReleaseDirective(appBuildFixture(), 'debuggable providers.gradleProperty("DEBUGGABLE").get()'),
    `${appBuildFixture()}\nbuildTypes.getByName("release").debuggable = false`,
    `${appBuildFixture()}\nandroid.buildTypes.release.setProperty("debuggable", true)`,
    `${appBuildFixture()}\nandroid.buildTypes.release.setProperty "debuggable", true`,
    `${appBuildFixture()}\nandroid.buildTypes.release.setProperty(releaseProperty, true)`,
    withReleaseDirective(appBuildFixture(), 'if (true) { setProperty("debuggable", true) }'),
    withBuildTypesDirective(
      appBuildFixture(),
      'getByName("release") { debuggable false }',
    ),
  ]) {
    const result = evaluateReleaseDebuggable(appBuild);
    assert.equal(result.status, READINESS_STATUS.technicalBlocker, result.detail);
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
  const nestedLink = appBuildFixture().replace(
    'signingConfig signingConfigs.release',
    'signingConfig signingConfigs.release\n        if (true) { signingConfig signingConfigs.debug }',
  );
  for (const appBuild of [duplicateLink, nestedLink]) {
    const result = evaluateReleaseSigning(appBuild);
    assert.equal(result.status, READINESS_STATUS.technicalBlocker);
    assert.match(result.detail, /signingConfig duplicadas/);
  }
});

test('signing bloquea overrides externos al bloque release canonico', () => {
  const qualifiedHardcoded = `${appBuildFixture()}\nsigningConfigs.release.storePassword = "hardcoded"`;
  const androidQualified = `${appBuildFixture()}\nandroid.signingConfigs.release.keyAlias = "hardcoded"`;
  const qualifiedProvider = `${appBuildFixture()}\nsigningConfigs.release.storePassword =\n  providers.environmentVariable("OTHER").get()`;
  const bracketOverride = `${appBuildFixture()}\nandroid["signingConfigs"]["release"]["storePassword"] = "hardcoded"`;
  const setterOverride = `${appBuildFixture()}\nandroid.signingConfigs.release.setKeyAlias("hardcoded")`;
  const propertiesOverride = `${appBuildFixture()}\nandroid.signingConfigs.release.properties["keyPassword"] = "hardcoded"`;
  const scopedSigning = envSigning.replace(
    /\n  }\s*$/,
    '\n    release.storePassword = "hardcoded"\n  }\n',
  );
  for (const appBuild of [
    qualifiedHardcoded,
    androidQualified,
    qualifiedProvider,
    bracketOverride,
    setterOverride,
    propertiesOverride,
    appBuildFixture(undefined, scopedSigning),
  ]) {
    const result = evaluateReleaseSigning(appBuild);
    assert.equal(result.status, READINESS_STATUS.technicalBlocker);
    assert.match(result.detail, /overrides fuera del bloque canónico/);
  }

  const commentedOverride = `${appBuildFixture()}\n// signingConfigs.release.storePassword = "hardcoded"`;
  assert.equal(evaluateReleaseSigning(commentedOverride).status, READINESS_STATUS.ready);
});

test('signing bloquea overrides externos del enlace buildTypes.release', () => {
  for (const override of [
    'buildTypes.release.signingConfig = signingConfigs.debug',
    'android.buildTypes.release.signingConfig = signingConfigs.release',
    'android["buildTypes"]["release"]["signingConfig"] = signingConfigs.debug',
    'android.buildTypes.release.setSigningConfig(signingConfigs.debug)',
  ]) {
    const result = evaluateReleaseSigning(`${appBuildFixture()}\n${override}`);
    assert.equal(result.status, READINESS_STATUS.technicalBlocker);
    assert.match(result.detail, /signingConfig tiene overrides fuera del bloque canónico/);
  }
  assert.equal(
    evaluateReleaseSigning(`${appBuildFixture()}\n/* buildTypes.release.signingConfig = signingConfigs.debug */`).status,
    READINESS_STATUS.ready,
  );
});

test('signing bloquea setProperty sobre campos protegidos de release', () => {
  for (const override of [
    'signingConfigs.release.setProperty("storePassword", "hardcoded")',
    'android.signingConfigs.getByName("release")\n  .setProperty("keyAlias", "hardcoded")',
    'signingConfigs.release.setProperty(signingProperty, "hardcoded")',
    'android.buildTypes.release.setProperty("signingConfig", signingConfigs.debug)',
    'android.buildTypes.release.setProperty(releaseProperty, signingConfigs.debug)',
  ]) {
    const result = evaluateReleaseSigning(`${appBuildFixture()}\n${override}`);
    assert.equal(result.status, READINESS_STATUS.technicalBlocker, result.detail);
  }

  const scopedSetProperty = envSigning.replace(
    '      storePassword providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    '      storePassword providers.environmentVariable("ANDROID_STORE_PASSWORD").get()\n' +
      '      if (true) { setProperty("storePassword", "hardcoded") }',
  );
  assert.equal(
    evaluateReleaseSigning(appBuildFixture(undefined, scopedSetProperty)).status,
    READINESS_STATUS.technicalBlocker,
  );
  assert.equal(
    evaluateReleaseSigning(
      `${appBuildFixture()}\n// signingConfigs.release.setProperty("storePassword", "hardcoded")`,
    ).status,
    READINESS_STATUS.ready,
  );
});

test('signing bloquea accessors dinámicos dirigidos a release', () => {
  for (const override of [
    'signingConfigs.getByName("release").storePassword = "hardcoded"',
    'android.signingConfigs.getByName("release").keyAlias = "hardcoded"',
    'signingConfigs.named("release").keyPassword = "hardcoded"',
    'signingConfigs.findByName("release").storeFile = file("hardcoded.jks")',
    'signingConfigs.maybeCreate("release").storePassword = "hardcoded"',
    'signingConfigs.getByName(targetConfig).storePassword = "hardcoded"',
    'buildTypes.getByName("release").signingConfig = signingConfigs.debug',
    'android.buildTypes.named("release").signingConfig = signingConfigs.debug',
  ]) {
    const result = evaluateReleaseSigning(`${appBuildFixture()}\n${override}`);
    assert.equal(result.status, READINESS_STATUS.technicalBlocker, result.detail);
    assert.match(result.detail, /accessor dinámico no canónico/);
  }

  const signingConfigsEnd = envSigning.lastIndexOf('}');
  const scopedSigning = `${envSigning.slice(0, signingConfigsEnd)}` +
    `  getByName("release") { storePassword "hardcoded" }\n  ${envSigning.slice(signingConfigsEnd)}`;
  for (const appBuild of [
    appBuildFixture(undefined, scopedSigning),
    withBuildTypesDirective(
      appBuildFixture(),
      'getByName("release") { signingConfig signingConfigs.debug }',
    ),
  ]) {
    const result = evaluateReleaseSigning(appBuild);
    assert.equal(result.status, READINESS_STATUS.technicalBlocker, result.detail);
    assert.match(result.detail, /accessor dinámico no canónico/);
  }

  assert.equal(
    evaluateReleaseSigning(
      `${appBuildFixture()}\n// signingConfigs.getByName("release").storePassword = "hardcoded"`,
    ).status,
    READINESS_STATUS.ready,
  );
  assert.equal(
    evaluateReleaseSigning(
      `${appBuildFixture()}\nsigningConfigs.getByName("debug").storePassword = "debug-only"`,
    ).status,
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
    origin: 'https://api.release-readiness.uy',
  });
  assert.equal(ready.blocked, false);
  assert.equal(ready.exitCode, 0);
  assert.ok(ready.entries.every(({ status }) =>
    status === READINESS_STATUS.ready || status === READINESS_STATUS.manualCheck));
});
