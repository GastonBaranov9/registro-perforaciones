// Inspect actual Gradle variants without packaging, signing, sync or installation.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import mobile from './mobile-build-config.cjs';

const android = fileURLToPath(new URL('../android/', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'rsp-mobile-lab-gradle-'));
try {
  const init = join(temporary, 'probe.gradle');
  await writeFile(init, `gradle.projectsEvaluated {
    def app = rootProject.project(':app')
    rootProject.tasks.register('rspMobileIdentityProbe') {
      doLast {
        app.android.applicationVariants.each { variant ->
          println('RSP_ID|' + variant.name + '|' + variant.applicationId)
        }
        println('RSP_LAB_RES|' + app.android.sourceSets.debug.res.srcDirs.any { it.path.replace('\\\\', '/').endsWith('/src/mobileLab/res') })
        if (!app.tasks.preBuild.taskDependencies.getDependencies(app.tasks.preBuild).any { it.name == 'verifyMobileIsolation' }) {
          throw new GradleException('Falta barrera preBuild')
        }
      }
    }
  }`);
  for (const variant of ['production', 'lab']) {
    const args = ['--offline', '--no-daemon', '--console=plain', '--max-workers=1', '-I', init, 'rspMobileIdentityProbe'];
    const executable = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
    const command = ['-classpath', join(android, 'gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', ...args];
    const result = spawnSync(executable, command, { cwd: android, env: { ...process.env, RSP_MOBILE_VARIANT: variant }, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Gradle ${variant} falló:\n${result.stdout}\n${result.stderr}`);
    const expectedId = variant === 'lab' ? mobile.LAB_ID : mobile.PRODUCTION_ID;
    assert.ok(result.stdout.includes(`RSP_ID|debug|${expectedId}`));
    assert.ok(result.stdout.includes(`RSP_LAB_RES|${variant === 'lab'}`));
    console.log(`GRADLE_IDENTITY_OK ${variant}: ${expectedId}; barrera preBuild presente`);
    if (variant === 'lab') {
      const blocked = spawnSync(executable, [...command.slice(0, -1), ':app:assembleRelease', '--dry-run'], {
        cwd: android, env: { ...process.env, RSP_MOBILE_VARIANT: 'lab' }, encoding: 'utf8', windowsHide: true,
      });
      assert.notEqual(blocked.status, 0);
      assert.ok((blocked.stdout + blocked.stderr).includes('Laboratorio sólo admite debug'));
      console.log('GRADLE_LAB_RELEASE_BLOCKED (dry-run, sin empaquetar)');
    }
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
