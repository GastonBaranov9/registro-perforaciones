import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const GRADLE_PROBE_PREFIX = 'RSP_NATIVE_RELEASE_PROBE_JSON=';

export const GRADLE_PROBE_INIT_SCRIPT = `
import groovy.json.JsonOutput

def releaseVariants = []
def releaseSigningMarker = null

gradle.beforeProject { project ->
  if (project.path == ':app') {
    project.pluginManager.withPlugin('com.android.application') {
      def androidComponents = project.extensions.getByName('androidComponents')
      androidComponents.finalizeDsl { android ->
        def canonicalReleaseSigning = android.signingConfigs.findByName('release')
        if (canonicalReleaseSigning != null) {
          def signingMarker = (0..<16).find { candidate ->
            !android.signingConfigs.any { config ->
              config.name != 'release' &&
                ((config.enableV1Signing == true ? 1 : 0) |
                  (config.enableV2Signing == true ? 2 : 0) |
                  (config.enableV3Signing == true ? 4 : 0) |
                  (config.enableV4Signing == true ? 8 : 0)) == candidate
            }
          }
          if (signingMarker != null) {
            releaseSigningMarker = [
              v1: (signingMarker & 1) != 0,
              v2: (signingMarker & 2) != 0,
              v3: (signingMarker & 4) != 0,
              v4: (signingMarker & 8) != 0,
            ]
            canonicalReleaseSigning.enableV1Signing = releaseSigningMarker.v1
            canonicalReleaseSigning.enableV2Signing = releaseSigningMarker.v2
            canonicalReleaseSigning.enableV3Signing = releaseSigningMarker.v3
            canonicalReleaseSigning.enableV4Signing = releaseSigningMarker.v4
          }
        }
      }
      androidComponents.onVariants(androidComponents.selector().withBuildType('release')) { variant ->
        releaseVariants.add(variant)
      }

      project.tasks.register('rspNativeReleaseProbe') {
        group = 'verification'
        description = 'Reports sanitized effective release metadata for the local readiness gate.'
        doLast {
          def android = project.extensions.getByName('android')
          def expectedStoreFile = System.getenv('RSP_PROBE_EXPECT_STORE_FILE')
          def expectedStorePassword = System.getenv('RSP_PROBE_EXPECT_STORE_PASSWORD')
          def expectedKeyAlias = System.getenv('RSP_PROBE_EXPECT_KEY_ALIAS')
          def expectedKeyPassword = System.getenv('RSP_PROBE_EXPECT_KEY_PASSWORD')

          def variants = releaseVariants.collect { variant ->
            def buildType = android.buildTypes.findByName(variant.buildType)
            def canonicalReleaseSigning = android.signingConfigs.findByName('release')
            def selectedSigning = buildType?.signingConfig
            def effectiveSigning = variant.signingConfig
            def flavorSigningConfigured = variant.productFlavors.any { flavor ->
              android.productFlavors.findByName(flavor.second)?.signingConfig != null
            }
            def selectedStoreFile = selectedSigning?.storeFile
            def storeFileMatches = expectedStoreFile != null && selectedStoreFile != null &&
              selectedStoreFile.canonicalFile == new File(expectedStoreFile).canonicalFile

            [
              name: variant.name,
              buildType: variant.buildType,
              productFlavors: variant.productFlavors.collect { flavor ->
                [dimension: flavor.first, name: flavor.second]
              },
              applicationId: variant.applicationId.orNull,
              namespace: variant.namespace.orNull,
              debuggable: variant.debuggable,
              outputs: variant.outputs.collect { output ->
                [
                  enabled: output.enabled.getOrElse(true),
                  versionCode: output.versionCode.orNull,
                  versionName: output.versionName.orNull,
                ]
              },
              signing: [
                selectedName: selectedSigning?.name,
                selectedIsCanonicalRelease: selectedSigning != null &&
                  canonicalReleaseSigning != null && selectedSigning.is(canonicalReleaseSigning),
                effectiveSelectionMatchesCanonicalMarker: releaseSigningMarker != null &&
                  effectiveSigning.enableV1Signing.orNull == releaseSigningMarker.v1 &&
                  effectiveSigning.enableV2Signing.orNull == releaseSigningMarker.v2 &&
                  effectiveSigning.enableV3Signing.orNull == releaseSigningMarker.v3 &&
                  effectiveSigning.enableV4Signing.orNull == releaseSigningMarker.v4,
                selectionUnambiguous: android.defaultConfig.signingConfig == null &&
                  !flavorSigningConfigured,
                fields: [
                  storeFile: [
                    present: selectedStoreFile != null,
                    matchesSentinel: storeFileMatches,
                  ],
                  storePassword: [
                    present: selectedSigning?.storePassword != null,
                    matchesSentinel: expectedStorePassword != null &&
                      selectedSigning?.storePassword == expectedStorePassword,
                  ],
                  keyAlias: [
                    present: selectedSigning?.keyAlias != null,
                    matchesSentinel: expectedKeyAlias != null &&
                      selectedSigning?.keyAlias == expectedKeyAlias,
                  ],
                  keyPassword: [
                    present: selectedSigning?.keyPassword != null,
                    matchesSentinel: expectedKeyPassword != null &&
                      selectedSigning?.keyPassword == expectedKeyPassword,
                  ],
                ],
              ],
            ]
          }

          println('${GRADLE_PROBE_PREFIX}' + JsonOutput.toJson([
            schemaVersion: 1,
            projectPath: project.path,
            variants: variants,
          ]))
        }
      }
    }
  }
}
`;

function safeProbeError(message) {
  const error = new Error(message);
  error.name = 'GradleReleaseProbeError';
  return error;
}

export function parseGradleProbeOutput(output) {
  const reports = String(output)
    .split(/\r?\n/)
    .filter((line) => line.startsWith(GRADLE_PROBE_PREFIX));
  if (reports.length !== 1) {
    throw safeProbeError(
      reports.length === 0
        ? 'Gradle no produjo el reporte sanitizado del modelo release'
        : 'Gradle produjo múltiples reportes ambiguos del modelo release',
    );
  }
  let report;
  try {
    report = JSON.parse(reports[0].slice(GRADLE_PROBE_PREFIX.length));
  } catch {
    throw safeProbeError('Gradle produjo un reporte release inválido');
  }
  if (report?.schemaVersion !== 1 || report.projectPath !== ':app' ||
      !Array.isArray(report.variants)) {
    throw safeProbeError('El reporte Gradle release no cumple el contrato esperado');
  }
  return report;
}

function externalSourceKey(source) {
  return `${source.kind}:${source.name}`;
}

async function sentinelInputs(signingContract, temporaryDirectory) {
  const nonce = randomUUID().replaceAll('-', '');
  const sources = signingContract?.probeSources ?? [];
  const sourceValues = new Map();
  for (const source of sources) {
    const key = externalSourceKey(source);
    if (sourceValues.has(key)) continue;
    const usedForStoreFile = sources.some((candidate) =>
      externalSourceKey(candidate) === key && candidate.field === 'storeFile');
    const value = usedForStoreFile
      ? resolve(temporaryDirectory, `rsp-probe-${nonce}.jks`)
      : `RSP_PROBE_${nonce}_${sourceValues.size}`;
    sourceValues.set(key, value);
    if (usedForStoreFile) await writeFile(value, 'synthetic probe file\n', 'utf8');
  }

  const environment = { ...process.env };
  for (const source of sources) {
    const value = sourceValues.get(externalSourceKey(source));
    if (source.kind === 'environment') environment[source.name] = value;
  }

  const expectedEnvironmentNames = {
    storeFile: 'RSP_PROBE_EXPECT_STORE_FILE',
    storePassword: 'RSP_PROBE_EXPECT_STORE_PASSWORD',
    keyAlias: 'RSP_PROBE_EXPECT_KEY_ALIAS',
    keyPassword: 'RSP_PROBE_EXPECT_KEY_PASSWORD',
  };
  for (const name of Object.values(expectedEnvironmentNames)) delete environment[name];
  for (const [field, source] of Object.entries(signingContract?.fields ?? {})) {
    environment[expectedEnvironmentNames[field]] = sourceValues.get(externalSourceKey(source));
  }
  return environment;
}

function runProcess(command, args, options) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectProcess);
    child.on('close', (status) => resolveProcess({ status, stdout, stderr }));
  });
}

export async function runGradleReleaseProbe({
  projectRoot,
  wrapperRoot = projectRoot,
  signingContract,
}) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rsp-native-release-probe-'));
  try {
    const initScript = join(temporaryDirectory, 'probe.init.gradle');
    await writeFile(initScript, GRADLE_PROBE_INIT_SCRIPT, 'utf8');
    const environment = await sentinelInputs(
      signingContract,
      temporaryDirectory,
    );
    const javaExecutable = process.env.JAVA_HOME
      ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      : 'java';
    const wrapperJar = join(wrapperRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar');
    const javaHomeArguments = process.env.USERPROFILE
      ? [
          `-Duser.home=${process.env.USERPROFILE}`,
          `-Dgradle.user.home=${join(process.env.USERPROFILE, '.gradle')}`,
        ]
      : [];
    const result = await runProcess(javaExecutable, [
      ...javaHomeArguments,
      '-classpath',
      wrapperJar,
      'org.gradle.wrapper.GradleWrapperMain',
      '--init-script',
      initScript,
      '--console=plain',
      '--quiet',
      '--no-daemon',
      ':app:rspNativeReleaseProbe',
    ], {
      cwd: projectRoot,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
      throw safeProbeError(`Gradle release probe falló con código ${result.status ?? 'desconocido'}`);
    }
    return parseGradleProbeOutput(result.stdout);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
