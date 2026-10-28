import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import mobile from './mobile-build-config.cjs';
import { validateNativeBackendOrigin, deriveNativeWebsocketOrigin } from './native-backend-config.mjs';
import { recordNativeArtifact, verifyNativeArtifact, nativeCsp } from './native-artifact.mjs';
import { validateLabCompose, validateLabEnvironment } from '../../ops/mobile-lab/validate.mjs';
import { cargarConfiguracionRuntime } from '../../api/src/config/runtime.ts';

// Synthetic fixtures only. No DNS requests or Docker operations in this suite.
const origin = 'https://device-lab.example.invalid';
const config = () => ({ appId: mobile.LAB_ID, backendOrigin: origin, allowedOrigins: [origin] });
const selection = { variant: 'lab', appId: mobile.LAB_ID, appName: mobile.LAB_NAME, origin };
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rsp-mobile-lab-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('identidades separadas; producción conserva identidad y directorio', () => {
  assert.notEqual(mobile.LAB_ID, mobile.PRODUCTION_ID);
  assert.equal(mobile.mobileSelection({}).appId, 'uy.com.raulsilva.perforaciones');
  assert.equal(mobile.mobileSelection({}).webDir, 'dist/front/browser');
  assert.equal(validateNativeBackendOrigin(origin, 'lab', config()), origin);
  assert.equal(validateNativeBackendOrigin('https://api.raulsilvaperforaciones.com', 'production'), 'https://api.raulsilvaperforaciones.com');
});

for (const bad of ['', undefined, 'http://device-lab.example.invalid', 'https://device-lab.example.invalid/',
  'https://device-lab.example.invalid/path', 'https://user:secret@device-lab.example.invalid',
  'https://device-lab.example.invalid?q=x', 'https://device-lab.example.invalid#x',
  'https://api.raulsilvaperforaciones.com', 'https://app.raulsilvaperforaciones.com',
  'https://api.raulsilvaperforaciones.com.', 'https://api.raulsilvaperforaciones.com:8443',
  'https://*.example.invalid', "https://a'b.example.invalid", 'https://127.0.0.1', 'https://localhost']) {
  test(`rechaza backend inseguro/productivo ${String(bad)}`, () => {
    assert.throws(() => mobile.validateLabConfig({ ...config(), backendOrigin: bad, allowedOrigins: [bad] }));
  });
}
test('allowlist explícita, identidad, campos y selección coherentes', () => {
  for (const bad of [{ ...config(), allowedOrigins: [] }, { ...config(), allowedOrigins: ['https://otro.example.invalid'] },
    { ...config(), allowedOrigins: [origin, origin] }, { ...config(), appId: mobile.PRODUCTION_ID },
    { ...config(), ignoreTls: true }, null]) assert.throws(() => mobile.validateLabConfig(bad));
  assert.throws(() => mobile.validateLabConfig(config(), 'https://otro.example.invalid'));
});
test('selección privada lab y rechazo de parámetros mezclados/firma/TLS', async t => {
  const dir = await temporary(t);
  const file = join(dir, 'allowed.json');
  await writeFile(file, JSON.stringify(config()));
  const env = { RSP_MOBILE_VARIANT: 'lab', NATIVE_LAB_CONFIG: file };
  assert.equal(mobile.mobileSelection(env).appId, mobile.LAB_ID);
  for (const bad of [{ RSP_MOBILE_VARIANT: 'lab' }, { ...env, RSP_MOBILE_VARIANT: 'production' },
    { RSP_MOBILE_VARIANT: '' }, { ...env, NATIVE_APP_ID: '' },
    { ...env, NATIVE_APP_ID: mobile.PRODUCTION_ID }, { ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { ...env, ANDROID_KEY_ALIAS: 'distribution' }, { ...env, NATIVE_BACKEND_ORIGIN: 'https://otro.example.invalid' }]) {
    assert.throws(() => mobile.mobileSelection(bad));
  }
  const require = createRequire(import.meta.url);
  const previous = { RSP_MOBILE_VARIANT: process.env.RSP_MOBILE_VARIANT, NATIVE_LAB_CONFIG: process.env.NATIVE_LAB_CONFIG };
  try {
    Object.assign(process.env, env);
    const { loadConfig } = require('../node_modules/@capacitor/cli/dist/config.js');
    const cap = await loadConfig();
    assert.equal(cap.app.extConfig.appId, mobile.LAB_ID);
    assert.equal(cap.app.extConfig.appName, mobile.LAB_NAME);
    assert.equal(cap.app.extConfig.webDir, 'dist/mobile-lab/browser');
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('assets reales, CSP, WSS, identidad y alteraciones posteriores', async t => {
  const dir = await temporary(t);
  const ws = deriveNativeWebsocketOrigin(origin);
  assert.equal(ws, 'wss://device-lab.example.invalid');
  await writeFile(join(dir, 'index.html'), `<meta http-equiv="Content-Security-Policy" content="${nativeCsp(origin)}"><aside>ENTORNO DE PRUEBAS</aside>`);
  await writeFile(join(dir, 'main.js'), `const backend=${JSON.stringify(origin)};`);
  await recordNativeArtifact(dir, selection, 'lab', origin);
  await verifyNativeArtifact(dir, selection, { appId: mobile.LAB_ID, appName: mobile.LAB_NAME });
  await assert.rejects(verifyNativeArtifact(dir, selection, { appId: mobile.PRODUCTION_ID }));
  await assert.rejects(verifyNativeArtifact(dir, { ...selection, origin: 'https://otro.example.invalid' }));
  await writeFile(join(dir, 'main.js'), 'const backend="https://api.raulsilvaperforaciones.com";');
  await assert.rejects(verifyNativeArtifact(dir, selection), /alterados/);
  await assert.rejects(recordNativeArtifact(dir, selection, 'lab', origin), /productivo/);
});

test('CSP incorrecta bloquea un artefacto aunque su inventario sea consistente', async t => {
  const dir = await temporary(t);
  await writeFile(join(dir, 'index.html'), '<aside>ENTORNO DE PRUEBAS</aside><meta content="connect-src *">');
  await writeFile(join(dir, 'main.js'), `const backend=${JSON.stringify(origin)};`);
  await assert.rejects(recordNativeArtifact(dir, selection, 'lab', origin), /CSP/);
});

for (const [label, html] of [
  ['host adicional', `<meta http-equiv="Content-Security-Policy" content="${nativeCsp(origin).replace("; object-src", " https://no-autorizado.invalid; object-src")}">`],
  ['comentario', `<!-- <meta http-equiv="Content-Security-Policy" content="${nativeCsp(origin)}"> -->`],
  ['sin http-equiv', `<meta content="${nativeCsp(origin)}">`],
  ['políticas duplicadas', `<meta http-equiv="Content-Security-Policy" content="${nativeCsp(origin)}"><meta http-equiv="Content-Security-Policy" content="connect-src *">`],
]) test(`rechaza CSP aparente: ${label}`, async t => {
  const dir = await temporary(t);
  await writeFile(join(dir, 'index.html'), html + '<aside>ENTORNO DE PRUEBAS</aside>');
  await writeFile(join(dir, 'main.js'), `const backend=${JSON.stringify(origin)};`);
  await assert.rejects(recordNativeArtifact(dir, selection, 'lab', origin), /CSP/);
});

test('también verifica extras Cordova generados por Capacitor y WSS adulterado', async t => {
  const dir = await temporary(t);
  await writeFile(join(dir, 'index.html'), `<meta http-equiv="Content-Security-Policy" content="${nativeCsp(origin)}"><aside>ENTORNO DE PRUEBAS</aside>`);
  await writeFile(join(dir, 'main.js'), `const backend=${JSON.stringify(origin)};`);
  await recordNativeArtifact(dir, selection, 'lab', origin);
  await writeFile(join(dir, 'cordova_plugins.js'), 'const endpoint="https://API.RAULSILVAPERFORACIONES.COM"');
  await assert.rejects(verifyNativeArtifact(dir, selection), /productivo/);
  await writeFile(join(dir, 'cordova_plugins.js'), 'module.exports=[];');
  await verifyNativeArtifact(dir, selection);
  const manifest = JSON.parse(await readFile(join(dir, 'rsp-native-build.json'), 'utf8'));
  manifest.websocketOrigin = 'wss://otro.invalid';
  await writeFile(join(dir, 'rsp-native-build.json'), JSON.stringify(manifest));
  await assert.rejects(verifyNativeArtifact(dir, selection), /mezclados/);
});

test('Git excluye configuraciones privadas y artefactos, conserva las plantillas', () => {
  const ignored = ['mobile-lab.private.json', 'front/mobile-lab.private/config.json', 'ops/mobile-lab/.env',
    'front/dist/mobile-lab/browser/index.html', 'front/android/app/build/outputs/apk/debug/app-debug.apk'];
  const result = spawnSync('git', ['check-ignore', '--stdin'], { input: ignored.join('\n'), encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), ignored);
  const template = spawnSync('git', ['check-ignore', 'mobile-lab.example.json'], { encoding: 'utf8' });
  assert.equal(template.status, 1);
});

test('build rechaza archivos temporales preexistentes sin sobrescribirlos ni borrarlos', async t => {
  const dir = await temporary(t);
  const front = join(dir, 'front');
  await mkdir(join(front, 'scripts'), { recursive: true });
  await mkdir(join(front, 'src/environments'), { recursive: true });
  for (const name of ['build-native.mjs', 'mobile-build-config.cjs', 'native-artifact.mjs', 'native-backend-config.mjs', 'native-style-contract.mjs']) {
    await copyFile(new URL(name, import.meta.url), join(front, 'scripts', name));
  }
  await writeFile(join(front, 'capacitor.config.ts'), `const config = { appId: '${mobile.PRODUCTION_ID}' };`);
  const environment = join(front, 'src/environments/environment.native.generated.ts');
  const index = join(front, 'src/index.native.generated.html');
  await writeFile(environment, 'sentinel-owner-environment');
  await writeFile(index, 'sentinel-owner-index');
  const result = spawnSync(process.execPath, ['scripts/build-native.mjs', 'production'], {
    cwd: front, env: { ...process.env, RSP_MOBILE_VARIANT: 'production', NATIVE_BACKEND_ORIGIN: 'https://api.release-readiness.uy' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EEXIST/);
  assert.equal(await readFile(environment, 'utf8'), 'sentinel-owner-environment');
  assert.equal(await readFile(index, 'utf8'), 'sentinel-owner-index');
});

const compose = JSON.parse(await readFile(new URL('../../ops/mobile-lab/compose.json', import.meta.url), 'utf8'));
test('Compose aislado estático: sólo loopback, sin datos personales ni secretos', () => {
  assert.equal(validateLabCompose(compose), true);
  assert.equal(compose.services.bootstrap.environment.ADMIN_EMAIL, 'admin@rsp-mobile-lab.invalid');
  assert.ok(!JSON.stringify(compose).includes('3284'));
});

test('CLI del laboratorio falla sin imprimir valores privados inválidos', async t => {
  const dir = await temporary(t);
  const file = join(dir, 'mobile-lab.private.json');
  await writeFile(file, JSON.stringify(config()));
  const secret = 'SYNTHETIC_MUST_NOT_BE_LOGGED';
  const result = spawnSync(process.execPath, ['../ops/mobile-lab/validate.mjs', '--environment'], {
    env: { ...process.env, RSP_MOBILE_VARIANT: 'lab', NATIVE_LAB_CONFIG: file,
      LAB_ORIGIN: origin, LAB_HOST: new URL(origin).hostname, LAB_GIT_SHA: 'a'.repeat(40),
      LAB_PG_PASSWORD: secret, LAB_COOKIE_SECRET: 'c'.repeat(64), LAB_TOKEN_SECRET: 'd'.repeat(64), LAB_MAP_KEY: 'synthetic-only' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MOBILE_LAB_INVALID/);
  assert.ok(!(result.stdout + result.stderr).includes(secret));
});
const mutations = [
  c => c.name = 'rsp-pilot',
  c => c.volumes.lab_db = { external: true, name: 'rsp-pilot_raul_silva_db' },
  c => c.networks.lab_edge = { external: true },
  c => c.services.api.volumes.push({ type: 'bind', source: 'C:/rsp-private-deployment', target: '/data' }),
  c => c.services.api.volumes[0].source = 'production',
  c => c.services.api.environment.PGHOST = 'host.docker.internal',
  c => c.services.api.environment.PGDATABASE = 'rsp_pilot',
  c => c.services.api.env_file = '../production.env',
  c => c.services.api.network_mode = 'host',
  c => c.services.proxy.ports = ['0.0.0.0:18080:8080'],
  c => c.services.api.build.context = '../../private-production',
  c => c.services.api.image = 'otra-api:latest',
  c => c.services.front.volumes = [{ type: 'volume', source: 'lab_db', target: '/data' }],
  c => c.services.api.build.args.GIT_SHA = 'otro-sha',
  c => c.services.api.build.args.FASTIFY_SECRET = 'fixture-not-a-secret',
  c => c.services.api.environment.FASTIFY_SECRET = '${FASTIFY_SECRET}',
  c => c.services.api.environment.NATIVE_TOKEN_HMAC_SECRET = c.services.api.environment.FASTIFY_SECRET,
  c => delete c.services.api.environment.PGUSER,
  c => c.services.api.environment.DATABASE_URL = 'postgres://postgres/enterprise',
  c => c.services.api.environment.PUBLIC_ORIGIN = '${PUBLIC_ORIGIN}',
  c => c.services.postgres.networks = ['lab_edge'],
];
mutations.forEach((mutate, index) => test(`rechaza configuración Compose insegura ${index + 1}`, () => {
  const changed = structuredClone(compose); mutate(changed); assert.throws(() => validateLabCompose(changed));
}));
test('entorno de lab exige secretos independientes y rechaza ambiente productivo mezclado', () => {
  const env = { LAB_ORIGIN: origin, LAB_HOST: new URL(origin).hostname, LAB_GIT_SHA: 'a'.repeat(40),
    LAB_PG_PASSWORD: 'b'.repeat(64), LAB_COOKIE_SECRET: 'c'.repeat(64), LAB_TOKEN_SECRET: 'd'.repeat(64), LAB_MAP_KEY: 'synthetic-fixture-only' };
  assert.equal(validateLabEnvironment(env, config()), true);
  // Exercise the real API runtime validator, without connecting to a database.
  const expanded = Object.fromEntries(Object.entries(compose.services.api.environment).map(([key, value]) =>
    [key, value.replace(/\$\{([A-Z_]+):\?[^}]+\}/g, (_, name) => env[name])]));
  const runtime = cargarConfiguracionRuntime(expanded);
  assert.equal(runtime.postgres.host, 'postgres');
  assert.equal(runtime.postgres.database, 'rsp_mobile_lab');
  assert.equal(runtime.trustProxy, 1);
  assert.deepEqual(runtime.nativeCorsOrigins, ['https://localhost', 'capacitor://localhost']);
  for (const bad of [{ ...env, COMPOSE_PROJECT_NAME: 'rsp-pilot' }, { ...env, PGHOST: 'postgres' },
    { ...env, COMPOSE_ENV_FILES: '../production.env' }, { ...env, DOCKER_HOST: 'tcp://remote:2375' },
    { ...env, LAB_COOKIE_SECRET: env.LAB_PG_PASSWORD }, { ...env, LAB_PG_PASSWORD: '' },
    { ...env, LAB_ORIGIN: 'https://api.raulsilvaperforaciones.com' }]) assert.throws(() => validateLabEnvironment(bad, config()));
});
