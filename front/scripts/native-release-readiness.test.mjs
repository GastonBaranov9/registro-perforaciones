import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  GRADLE_PROBE_INIT_SCRIPT,
  GRADLE_PROBE_PREFIX,
  parseGradleProbeOutput,
} from './native-gradle-release-probe.mjs';
import {
  evaluateAndroidIdentity,
  evaluateNativeReleaseReadiness,
  evaluateReleaseDebuggable,
  evaluateReleaseSigning,
  evaluateVersion,
  inspectReleaseSigningSource,
  READINESS_STATUS,
  selectEffectiveReleaseVariant,
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
      keyAlias System.getenv("ANDROID_KEY_ALIAS")
      keyPassword System.getenv("ANDROID_KEY_PASSWORD")
    }
  }
`;

function appBuildFixture(signing = envSigning) {
  return `android {
    namespace "uy.com.empresa.perforaciones"
    defaultConfig {
      applicationId "uy.com.empresa.perforaciones"
      versionCode 7
      versionName "1.2.3"
    }
    ${signing}
    buildTypes {
      release {
        signingConfig signingConfigs.release
      }
    }
  }`;
}

function signingFixture(overrides = {}) {
  const fields = Object.fromEntries(['storeFile', 'storePassword', 'keyAlias', 'keyPassword']
    .map((field) => [field, { present: true, matchesSentinel: true }]));
  return {
    selectedName: 'release',
    selectedIsCanonicalRelease: true,
    effectiveSelectionMatchesCanonicalMarker: true,
    selectionUnambiguous: true,
    fields,
    ...overrides,
  };
}

function variantFixture(overrides = {}) {
  return {
    name: 'release',
    buildType: 'release',
    productFlavors: [],
    applicationId: 'uy.com.empresa.perforaciones',
    namespace: 'uy.com.empresa.perforaciones',
    debuggable: false,
    outputs: [{ enabled: true, versionCode: 7, versionName: '1.2.3' }],
    signing: signingFixture(),
    ...overrides,
  };
}

function probeFixture(...variants) {
  return {
    schemaVersion: 1,
    projectPath: ':app',
    variants: variants.length > 0 ? variants : [variantFixture()],
  };
}

test('scanner estático de signing ignora comentarios y preserva strings', () => {
  const source = String.raw`
    def endpoint = "https://example.com/a//b/\"quoted\""
    // storePassword "commented"
    /* keyAlias "commented" */
  `;
  const effective = stripGradleComments(source);
  assert.match(effective, /https:\/\/example\.com\/a\/\/b/);
  assert.doesNotMatch(effective, /commented/);
});

test('contrato estático extrae sólo nombres de variables de entorno directas', () => {
  const contract = inspectReleaseSigningSource(appBuildFixture());
  assert.equal(contract.error, undefined);
  assert.deepEqual(contract.fields, {
    storeFile: { kind: 'environment', name: 'ANDROID_STORE_FILE' },
    storePassword: { kind: 'environment', name: 'ANDROID_STORE_PASSWORD' },
    keyAlias: { kind: 'environment', name: 'ANDROID_KEY_ALIAS' },
    keyPassword: { kind: 'environment', name: 'ANDROID_KEY_PASSWORD' },
  });
  assert.equal(JSON.stringify(contract).includes('password-value'), false);

  const commented = appBuildFixture().replace(
    '      storePassword providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    '      // storePassword "hardcoded"\n' +
      '      storePassword providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
  );
  assert.equal(inspectReleaseSigningSource(commented).error, undefined);
});

test('contrato estático rechaza gradleProperty en cualquiera de los cuatro campos', () => {
  const replacements = {
    storeFile: [
      'file(providers.environmentVariable("ANDROID_STORE_FILE").get())',
      'file(providers.gradleProperty("ANDROID_STORE_FILE").get())',
    ],
    storePassword: [
      'providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
      'providers.gradleProperty("ANDROID_STORE_PASSWORD").get()',
    ],
    keyAlias: [
      'System.getenv("ANDROID_KEY_ALIAS")',
      'providers.gradleProperty("ANDROID_KEY_ALIAS").get()',
    ],
    keyPassword: [
      'System.getenv("ANDROID_KEY_PASSWORD")',
      'providers.gradleProperty("ANDROID_KEY_PASSWORD").get()',
    ],
  };

  for (const [field, [allowed, projectProperty]] of Object.entries(replacements)) {
    const appBuild = appBuildFixture(envSigning.replace(allowed, projectProperty));
    const contract = inspectReleaseSigningSource(appBuild);
    assert.match(contract.error, new RegExp(field));
    assert.equal(evaluateReleaseSigning({
      appBuild,
      gradleProbe: probeFixture(),
      signingContract: contract,
    }).status, READINESS_STATUS.technicalBlocker);
  }
});

test('contrato estático bloquea signing ausente, duplicado, literal o indirecto', () => {
  const duplicate = envSigning.replace(
    '      storePassword providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    '      storePassword providers.environmentVariable("SAFE_A").get()\n' +
      '      storePassword providers.environmentVariable("SAFE_B").get()',
  );
  const hardcoded = envSigning.replace(
    'providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    '"hardcoded-secret"',
  );
  const fallback = envSigning.replace(
    'providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    'providers.environmentVariable("ANDROID_STORE_PASSWORD").orElse("fallback").get()',
  );
  const nullable = envSigning.replace(
    'providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    'providers.environmentVariable("ANDROID_STORE_PASSWORD").getOrNull()',
  );
  const indirect = envSigning.replace(
    'providers.environmentVariable("ANDROID_STORE_PASSWORD").get()',
    'signingProperties["storePassword"]',
  );
  const unwrappedStoreFile = envSigning.replace(
    'file(providers.environmentVariable("ANDROID_STORE_FILE").get())',
    'providers.environmentVariable("ANDROID_STORE_FILE").get()',
  );
  const reserved = envSigning.replace('ANDROID_STORE_PASSWORD', 'PATH');
  for (const appBuild of [
    appBuildFixture(''),
    appBuildFixture(duplicate),
    appBuildFixture(hardcoded),
    appBuildFixture(fallback),
    appBuildFixture(nullable),
    appBuildFixture(indirect),
    appBuildFixture(unwrappedStoreFile),
    appBuildFixture(reserved),
  ]) {
    assert.ok(inspectReleaseSigningSource(appBuild).error);
  }
});

test('output del probe se parsea por prefijo único y contrato versionado', () => {
  const report = probeFixture();
  assert.deepEqual(
    parseGradleProbeOutput(`ruido Gradle\n${GRADLE_PROBE_PREFIX}${JSON.stringify(report)}\n`),
    report,
  );
  assert.throws(() => parseGradleProbeOutput('sin reporte'));
  assert.throws(() => parseGradleProbeOutput(
    `${GRADLE_PROBE_PREFIX}${JSON.stringify(report)}\n` +
    `${GRADLE_PROBE_PREFIX}${JSON.stringify(report)}`,
  ));
  assert.throws(() => parseGradleProbeOutput(`${GRADLE_PROBE_PREFIX}{}`));
});

test('init script delega el modelo efectivo a APIs públicas y emite sólo estados sanitizados', () => {
  assert.match(GRADLE_PROBE_INIT_SCRIPT, /androidComponents\.onVariants/);
  assert.match(GRADLE_PROBE_INIT_SCRIPT, /androidComponents\.finalizeDsl/);
  assert.match(GRADLE_PROBE_INIT_SCRIPT, /selector\(\)\.withBuildType\('release'\)/);
  assert.match(GRADLE_PROBE_INIT_SCRIPT, /doLast/);
  assert.match(GRADLE_PROBE_INIT_SCRIPT, /matchesSentinel/);
  assert.doesNotMatch(GRADLE_PROBE_INIT_SCRIPT, /initWith|afterEvaluate|postBuildExtras/);
  assert.doesNotMatch(GRADLE_PROBE_INIT_SCRIPT, /storePassword:\s*selectedSigning/);
  assert.doesNotMatch(GRADLE_PROBE_INIT_SCRIPT, /keyAlias:\s*selectedSigning/);
  assert.doesNotMatch(GRADLE_PROBE_INIT_SCRIPT, /keyPassword:\s*selectedSigning/);
});

test('preflight standalone incluye los contratos production sin recursión por test:config', async () => {
  const source = await readFile(
    new URL('./check-native-release-readiness.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /production-contract\.test\.mjs/);
  assert.doesNotMatch(source, /test:config/);
});

test('selección release falla cerrado con cero o múltiples variantes', () => {
  assert.match(selectEffectiveReleaseVariant({ variants: [] }).error, /no informó variantes/);
  assert.match(
    selectEffectiveReleaseVariant({ variants: [variantFixture(), variantFixture({ name: 'demoRelease' })] }).error,
    /2 variantes release/,
  );
  assert.equal(selectEffectiveReleaseVariant(probeFixture()).variant.name, 'release');
});

test('identidad compara applicationId y namespace efectivos con el contrato Android', () => {
  const identity = identityFixture();
  const ready = evaluateAndroidIdentity({ ...identity, gradleProbe: probeFixture() });
  assert.equal(ready.status, READINESS_STATUS.ready, ready.detail);

  for (const variant of [
    variantFixture({ applicationId: 'uy.com.otro' }),
    variantFixture({ namespace: 'uy.com.otro' }),
  ]) {
    const result = evaluateAndroidIdentity({ ...identity, gradleProbe: probeFixture(variant) });
    assert.equal(result.status, READINESS_STATUS.technicalBlocker, result.detail);
  }

  const placeholder = identityFixture('com.example.app', 'front');
  const placeholderVariant = variantFixture({
    applicationId: 'com.example.app',
    namespace: 'com.example.app',
  });
  assert.equal(
    evaluateAndroidIdentity({ ...placeholder, gradleProbe: probeFixture(placeholderVariant) }).status,
    READINESS_STATUS.humanDecision,
  );
});

test('versión valida los valores efectivos y bloquea outputs ambiguos', () => {
  assert.equal(evaluateVersion(probeFixture()).status, READINESS_STATUS.ready);
  for (const outputs of [
    [{ enabled: true, versionCode: 0, versionName: '1.0' }],
    [{ enabled: true, versionCode: 1, versionName: '' }],
    [{ enabled: true, versionCode: 1, versionName: '1.0\nunsafe' }],
    [
      { enabled: true, versionCode: 1, versionName: '1.0' },
      { enabled: true, versionCode: 2, versionName: '2.0' },
    ],
  ]) {
    assert.equal(
      evaluateVersion(probeFixture(variantFixture({ outputs }))).status,
      READINESS_STATUS.technicalBlocker,
    );
  }
  const suffixedEffective = probeFixture(variantFixture({
    outputs: [{ enabled: true, versionCode: 7, versionName: '1.2.3-prod' }],
  }));
  assert.match(evaluateVersion(suffixedEffective).detail, /versionName=1\.2\.3-prod/);
});

test('debuggable usa exclusivamente el booleano efectivo de la variante release', () => {
  assert.equal(evaluateReleaseDebuggable(probeFixture()).status, READINESS_STATUS.ready);
  assert.equal(
    evaluateReleaseDebuggable(probeFixture(variantFixture({ debuggable: true }))).status,
    READINESS_STATUS.technicalBlocker,
  );
  assert.equal(
    evaluateReleaseDebuggable(probeFixture(variantFixture({ debuggable: undefined }))).status,
    READINESS_STATUS.technicalBlocker,
  );
});

test('signing exige selección canónica y match de los cuatro sentinels', () => {
  const contract = inspectReleaseSigningSource(appBuildFixture());
  assert.equal(evaluateReleaseSigning({
    appBuild: appBuildFixture(),
    gradleProbe: probeFixture(),
    signingContract: contract,
  }).status, READINESS_STATUS.ready);

  const mismatchedFields = signingFixture();
  mismatchedFields.fields.storePassword = { present: true, matchesSentinel: false };
  for (const signing of [
    signingFixture({ selectedName: 'debug', selectedIsCanonicalRelease: false }),
    signingFixture({ effectiveSelectionMatchesCanonicalMarker: false }),
    signingFixture({ selectionUnambiguous: false }),
    mismatchedFields,
    signingFixture({ fields: {} }),
  ]) {
    const result = evaluateReleaseSigning({
      appBuild: appBuildFixture(),
      gradleProbe: probeFixture(variantFixture({ signing })),
      signingContract: contract,
    });
    assert.equal(result.status, READINESS_STATUS.technicalBlocker, result.detail);
  }
});

test('preflight sintético bloquea placeholders y permite un modelo futuro seguro', () => {
  const placeholder = identityFixture('com.example.app', 'front');
  const placeholderVariant = variantFixture({
    applicationId: 'com.example.app',
    namespace: 'com.example.app',
    signing: signingFixture({
      selectedName: null,
      selectedIsCanonicalRelease: false,
      fields: {},
    }),
  });
  const blocked = evaluateNativeReleaseReadiness({
    ...placeholder,
    appBuild: appBuildFixture(''),
    gradleProbe: probeFixture(placeholderVariant),
    origin: 'https://api.release-readiness.uy',
  });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.exitCode, 2);
  assert.deepEqual(
    blocked.entries
      .filter(({ status }) => status === READINESS_STATUS.technicalBlocker ||
        status === READINESS_STATUS.humanDecision)
      .map(({ item }) => item),
    ['application identity', 'app name', 'release signing'],
  );

  const ready = evaluateNativeReleaseReadiness({
    ...identityFixture(),
    appBuild: appBuildFixture(),
    gradleProbe: probeFixture(),
    origin: 'https://api.release-readiness.uy',
  });
  assert.equal(ready.blocked, false);
  assert.equal(ready.exitCode, 0);
});
