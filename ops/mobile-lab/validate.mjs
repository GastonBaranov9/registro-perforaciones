import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mobile from '../../front/scripts/mobile-build-config.cjs';

export function validateLabCompose(config) {
  const gitSha = '${LAB_GIT_SHA:?Falta SHA de laboratorio}';
  const database = { PGHOST: 'postgres', PGPORT: '5432', PGUSER: 'rsp_mobile_lab',
    PGDATABASE: 'rsp_mobile_lab', PGPASSWORD: '${LAB_PG_PASSWORD:?Falta secreto independiente}' };
  assert.equal(config.name, 'rsp-mobile-lab', 'Proyecto incorrecto');
  assert.deepEqual(Object.keys(config).sort(), ['name', 'networks', 'services', 'volumes']);
  assert.deepEqual(config.volumes, { lab_db: {}, lab_files: {} });
  assert.deepEqual(config.networks, { lab_db: { internal: true }, lab_edge: {} });
  assert.deepEqual(Object.keys(config.services).sort(), ['api', 'bootstrap', 'front', 'migrate', 'postgres', 'proxy']);
  const text = JSON.stringify(config);
  assert.ok(!/rsp-pilot|raul_silva_db|raul_silva_fotos|rsp-private-deployment|host\.docker\.internal|raulsilvaperforaciones\.com|docker\.sock/i.test(text), 'Referencia productiva prohibida');
  for (const [name, service] of Object.entries(config.services)) {
    const allowedKeys = ['image', 'build', 'restart', 'environment', 'volumes', 'networks', 'healthcheck', 'depends_on', 'profiles', 'command', 'ports', 'stdin_open', 'stop_grace_period'];
    assert.ok(Object.keys(service).every(key => allowedKeys.includes(key)), `Propiedad insegura en ${name}`);
    assert.deepEqual(service.networks, name === 'api' ? ['lab_db', 'lab_edge'] :
      ['front', 'proxy'].includes(name) ? ['lab_edge'] : ['lab_db']);
    assert.equal(service.restart, 'no');
    if (name !== 'postgres') assert.equal(service.image,
      `rsp-mobile-lab-${['migrate', 'bootstrap'].includes(name) ? 'api' : name}:` + '${LAB_GIT_SHA:?Falta SHA de laboratorio}');
    else assert.match(service.image, /^postgres:16\.[^@]+@sha256:[a-f0-9]{64}$/);
    assert.ok(!service.environment?.PGHOST || service.environment.PGHOST === 'postgres');
    if (['api', 'migrate', 'bootstrap'].includes(name)) {
      for (const [key, value] of Object.entries(database)) assert.equal(service.environment?.[key], value, `Destino de base incorrecto: ${name}/${key}`);
      assert.ok(!service.environment.DATABASE_URL && !service.environment.PGHOSTADDR && !service.environment.PGSERVICE);
    }
    for (const mount of service.volumes || []) {
      assert.equal(mount.type, 'volume', 'No se admiten bind mounts');
      assert.deepEqual(Object.keys(mount).sort(), ['source', 'target', 'type']);
      assert.ok(['lab_db', 'lab_files'].includes(mount.source), 'Volumen ajeno');
    }
    if (name !== 'proxy') assert.ok(!service.ports, 'Sólo el proxy publica puerto local');
    if (name !== 'postgres') {
      assert.ok(service.build);
      assert.ok(Object.keys(service.build).every(key => ['context', 'target', 'args'].includes(key)));
      assert.equal(service.build.context, ['api', 'migrate', 'bootstrap'].includes(name) ? '../../api' : name === 'front' ? '../../front' : './proxy');
      if (name === 'proxy') assert.deepEqual(service.build, { context: './proxy' });
      else {
        assert.equal(service.build.target, 'production');
        assert.deepEqual(service.build.args, { APP_VERSION: 'mobile-lab', GIT_SHA: gitSha });
      }
    } else assert.ok(!service.build);
    if (!['postgres', 'api'].includes(name)) assert.ok(!service.volumes, 'Servicio sin persistencia autorizada');
    if (!['migrate', 'bootstrap'].includes(name)) assert.ok(!service.command, 'Comando no autorizado');
  }
  assert.deepEqual(config.services.proxy.ports, ['127.0.0.1:18080:8080']);
  assert.deepEqual(config.services.postgres.volumes, [{ type: 'volume', source: 'lab_db', target: '/var/lib/postgresql/data' }]);
  assert.deepEqual(config.services.api.volumes, [{ type: 'volume', source: 'lab_files', target: '/var/lib/registro-perforaciones' }]);
  assert.equal(config.services.postgres.environment.POSTGRES_DB, 'rsp_mobile_lab');
  assert.equal(config.services.postgres.environment.POSTGRES_USER, 'rsp_mobile_lab');
  assert.equal(config.services.postgres.environment.POSTGRES_PASSWORD, '${LAB_PG_PASSWORD:?Falta secreto independiente}');
  assert.deepEqual(config.services.migrate.command, ['npm', 'run', 'db:migrate']);
  assert.deepEqual(config.services.bootstrap.command, ['npm', 'run', 'bootstrap:admin', '--', '--password-stdin']);
  assert.equal(config.services.api.environment.NODE_ENV, 'production');
  const expectedApi = { ...database, NODE_ENV: 'production', API_PORT: '3000', APP_VERSION: 'mobile-lab', GIT_SHA: gitSha,
    FASTIFY_SECRET: '${LAB_COOKIE_SECRET:?Falta secreto independiente}',
    NATIVE_TOKEN_HMAC_SECRET: '${LAB_TOKEN_SECRET:?Falta secreto independiente}',
    MIN_NATIVE_ANDROID_BUILD: '1', MIN_NATIVE_IOS_BUILD: '1',
    NATIVE_CORS_ORIGINS: 'https://localhost,capacitor://localhost',
    PUBLIC_HOST: '${LAB_HOST:?Falta hostname autorizado}', PUBLIC_ORIGIN: '${LAB_ORIGIN:?Falta HTTPS autorizado}',
    FOTOS_DIR: '/var/lib/registro-perforaciones/fotos', ENABLE_API_DOCS: 'false',
    MAP_STATIC_URL_TEMPLATE: 'https://maps.googleapis.com/maps/api/staticmap?center={lat},{lon}&zoom=14&size=600x400&key={apiKey}',
    MAP_STATIC_ALLOWED_HOST: 'maps.googleapis.com', MAP_STATIC_API_KEY: '${LAB_MAP_KEY:?Falta clave exclusiva de laboratorio}',
    MAP_STATIC_ATTRIBUTION: 'Google Maps' };
  assert.deepEqual(config.services.api.environment, expectedApi, 'Contrato de entorno API modificado');
  assert.deepEqual(config.services.migrate.environment, database);
  assert.deepEqual(config.services.bootstrap.environment, { ...database, NODE_ENV: 'production',
    ADMIN_EMAIL: 'admin@rsp-mobile-lab.invalid', ADMIN_NAME: 'Administrador Laboratorio' });
  assert.deepEqual(config.services.proxy.environment, { LAB_HOST: '${LAB_HOST:?Falta hostname autorizado}' });
  assert.ok(!config.services.front.environment);
  return true;
}

export function validateLabEnvironment(env, allowedConfig) {
  for (const key of ['COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES',
    'DOCKER_HOST', 'DOCKER_CONTEXT', 'PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'DATABASE_URL']) {
    assert.ok(!env[key], `No mezclar ${key} con laboratorio`);
  }
  mobile.validateLabConfig(allowedConfig, env.LAB_ORIGIN);
  assert.equal(env.LAB_HOST, new URL(env.LAB_ORIGIN).hostname);
  assert.match(env.LAB_GIT_SHA || '', /^[a-f0-9]{40}$/);
  const secrets = ['LAB_PG_PASSWORD', 'LAB_COOKIE_SECRET', 'LAB_TOKEN_SECRET'].map(key => env[key]);
  for (const secret of secrets) assert.ok(/^[a-f0-9]{64}$/.test(secret || ''), 'Generar secretos aleatorios propios');
  assert.equal(new Set(secrets).size, secrets.length, 'Secretos deben ser independientes');
  assert.ok(env.LAB_MAP_KEY && !/placeholder|change|example/i.test(env.LAB_MAP_KEY), 'Falta configuración Maps independiente');
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(process.argv.slice(2).every(arg => arg === '--environment'), 'Argumento no admitido');
    const config = JSON.parse(readFileSync(new URL('./compose.json', import.meta.url), 'utf8'));
    validateLabCompose(config);
    if (process.argv.includes('--environment')) {
      const selection = mobile.mobileSelection();
      assert.equal(selection.variant, 'lab');
      validateLabEnvironment(process.env, JSON.parse(readFileSync(process.env.NATIVE_LAB_CONFIG, 'utf8')));
    }
    console.log('MOBILE_LAB_STATIC_OK (no se inició ningún servicio)');
  } catch {
    // Assertion diffs may contain an operator's accidentally pasted secret. Never print them.
    console.error('MOBILE_LAB_INVALID: revisar contrato Compose, selección privada y variables de laboratorio. No se inició ningún servicio.');
    process.exitCode = 1;
  }
}
