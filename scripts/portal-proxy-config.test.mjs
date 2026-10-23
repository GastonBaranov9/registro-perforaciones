import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../', import.meta.url));
const compose = readFileSync(path.join(repo, 'docker-compose.production.yaml'), 'utf8');
const image = compose.match(/  proxy:\s+image: (\S+)/)[1];
const appHost = 'app.raulsilvaperforaciones.com';
const apiHost = 'api.raulsilvaperforaciones.com';

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 30_000, ...options });
  assert.equal(result.status, 0, `${binary}: ${result.error ?? ''}\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}
const docker = (...args) => command('docker', args);
const mount = (source, target) => ['-v', `${source.replaceAll('\\', '/')}:${target}:ro`];

function request(port, host, route = '/', headers = {}, tls = true) {
  return new Promise((resolve, reject) => {
    const req = (tls ? https : http).request({
      hostname: '127.0.0.1', port, path: route, rejectUnauthorized: false,
      servername: appHost, headers: { Host: host, ...headers }, timeout: 3000,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (data) => { body += data; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode, headers: res.headers, body: '' });
    });
    req.on('timeout', () => req.destroy(new Error('proxy fixture timeout')));
    req.on('error', reject);
    req.end();
  });
}

test('contrato APP/API en Nginx real, sin servicios de produccion', async (t) => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'rsp-portal-proxy-'));
  const cert = path.join(temp, 'tls.crt');
  const key = path.join(temp, 'tls.key');
  command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '1',
    '-subj', '/CN=portal.example.test', '-keyout', key, '-out', cert],
  { env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' } });
  // Upstreams simulados dentro del mismo contenedor; sin DB ni red de produccion.
  const upstreams = path.join(temp, 'upstreams.conf');
  writeFileSync(upstreams, `
server {
    listen 127.0.0.2:80;
    location / { return 200 "angular-fixture"; }
}
server {
    listen 3000;
    location / {
        return 200 "$request_uri|$http_host|$http_origin|$http_authorization|$http_x_forwarded_host|$http_x_forwarded_proto|$http_x_forwarded_for";
    }
    location = /ws {
        add_header Upgrade websocket always;
        add_header Connection upgrade always;
        return 101;
    }
}
`);

  await t.test('Compose transmite defaults legacy y hosts separados a los tres servicios', () => {
    const baseEnv = {
      PUBLIC_HOST: apiHost, PUBLIC_ORIGIN: `https://${apiHost}`, APP_HOST: '', API_HOST: '',
      API_IMAGE_REF: 'fixture/api:test', FRONT_IMAGE_REF: 'fixture/front:test', PGUSER: 'fixture',
      PGPASSWORD: 'fixture', PGDATABASE: 'fixture', FASTIFY_SECRET: 'fixture', NATIVE_TOKEN_HMAC_SECRET: 'fixture',
      MIN_NATIVE_ANDROID_BUILD: '1', MIN_NATIVE_IOS_BUILD: '1', MAP_STATIC_URL_TEMPLATE: 'https://maps.example.test',
      MAP_STATIC_ALLOWED_HOST: 'maps.example.test', MAP_STATIC_API_KEY: 'fixture', MAP_STATIC_ATTRIBUTION: 'fixture',
      BACKUP_DIR: temp.replaceAll('\\', '/'), TLS_CERT_FILE: cert.replaceAll('\\', '/'), TLS_KEY_FILE: key.replaceAll('\\', '/'),
    };
    for (const split of [false, true]) {
      const envFile = path.join(temp, 'compose.env');
      const fixture = { ...baseEnv, ...(split ? {
        PUBLIC_HOST: appHost, PUBLIC_ORIGIN: `https://${appHost}`, APP_HOST: appHost, API_HOST: apiHost,
      } : {}) };
      writeFileSync(envFile, Object.entries(fixture).map(([k, v]) => `${k}=${v}`).join('\n'));
      // Valores fixture tambien en el entorno: ninguna variable local puede sobreescribirlos.
      const parsed = JSON.parse(command('docker', ['compose', '--env-file', envFile, '-f',
        path.join(repo, 'docker-compose.production.yaml'), '--profile', 'ops', 'config', '--format', 'json'],
      { env: { ...process.env, ...fixture } }));
      for (const name of ['api', 'proxy', 'maintenance']) {
        assert.equal(parsed.services[name].environment.APP_HOST, split ? appHost : apiHost);
        assert.equal(parsed.services[name].environment.API_HOST, apiHost);
      }
      for (const name of ['proxy', 'maintenance']) {
        assert.deepEqual(parsed.services[name].entrypoint, ['/bin/sh', '/opt/rsp/start.sh']);
        assert.ok(parsed.services[name].volumes.some((v) => v.target === '/opt/rsp/start.sh' && v.read_only));
      }
    }
  });

  for (const mode of ['legacy', 'split', 'maintenance']) {
    await t.test(mode, async (t) => {
      const canonical = mode === 'legacy' ? apiHost : appHost;
      const publicPort = mode === 'legacy' ? ':9443' : '';
      const name = `rsp-portal-config-${process.pid}-${mode}`;
      const env = ['-e', `PUBLIC_HOST=${canonical}`, '-e', `PUBLIC_ORIGIN=https://${canonical}${publicPort}/`];
      if (mode !== 'legacy') env.push('-e', `APP_HOST=${appHost}`, '-e', `API_HOST=${apiHost}`);
      const template = mode === 'maintenance' ? 'maintenance' : 'https';
      docker('run', '--detach', '--name', name, '--pull=never',
        '--publish', '127.0.0.1::443', '--publish', '127.0.0.1::80',
        '--add-host', 'api:127.0.0.1', '--add-host', 'front:127.0.0.2',
        ...env, ...mount(path.join(repo, 'proxy/start.sh'), '/opt/rsp/start.sh'),
        ...mount(path.join(repo, `proxy/${template}.conf.template`), '/etc/nginx/templates/default.conf.template'),
        ...(mode === 'maintenance' ? [] : mount(upstreams, '/etc/nginx/conf.d/upstreams.conf')),
        ...mount(cert, '/etc/nginx/tls/tls.crt'), ...mount(key, '/etc/nginx/tls/tls.key'),
        '--entrypoint', '/bin/sh', image, '/opt/rsp/start.sh');
      t.after(() => docker('rm', '--force', name));
      const tlsPort = Number(docker('port', name, '443/tcp').split(':').at(-1));
      const httpPort = Number(docker('port', name, '80/tcp').split(':').at(-1));
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        try { await request(tlsPort, canonical); ready = true; break; }
        catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
      }
      assert.ok(ready, docker('logs', name));
      docker('exec', name, 'nginx', '-t');

      for (const host of ['evil.example.test', `${appHost}.evil.example.test`]) {
        for (const route of ['/', '/api/health', '/ws', '/maintenance-health']) {
          assert.equal((await request(tlsPort, host, route)).status, 421);
          assert.equal((await request(httpPort, host, route, {}, false)).status, 421);
        }
      }
      for (const host of mode === 'legacy' ? [apiHost] : [appHost, apiHost]) {
        const redirect = await request(httpPort, host, '/pozos-list?x=1', {}, false);
        assert.equal(redirect.status, 308);
        assert.equal(redirect.headers.location, `https://${host}${publicPort}/pozos-list?x=1`);
        if (mode === 'maintenance') {
          for (const route of ['/', '/pozos-list', '/api/', '/api/health', '/api/ready', '/ws']) {
            const response = await request(tlsPort, host, route);
            assert.equal(response.status, 503);
            assert.equal(response.headers['retry-after'], '120');
            assert.deepEqual(JSON.parse(response.body), { status: 'maintenance' });
          }
          assert.equal((await request(tlsPort, host, '/maintenance-health')).status, 200);
          continue;
        }
        for (const route of ['/', '/pozos-list', '/main.js']) {
          const response = await request(tlsPort, host, route);
          assert.equal(response.status, mode === 'split' && host === apiHost ? 404 : 200);
          if (response.status === 200) assert.equal(response.body, 'angular-fixture');
          assert.match(response.headers['content-security-policy'], /connect-src 'self'/);
        }
        const apiRedirect = await request(tlsPort, host, '/api');
        assert.equal(apiRedirect.status, 308);
        assert.match(apiRedirect.headers.location, /\/api\/$/);
        for (const route of ['/api/health', '/api/ready', '/api/auth/native/session?x=1']) {
          const response = await request(tlsPort, host, route, {
            Origin: `https://${canonical}${publicPort}`, Authorization: 'Bearer fixture',
            'X-Forwarded-Host': 'evil.example.test', 'X-Forwarded-Proto': 'http', 'X-Forwarded-For': 'spoofed',
          });
          assert.equal(response.status, 200);
          assert.ok(response.body.startsWith(`${route.slice(4)}|${host}|https://${canonical}${publicPort}|Bearer fixture|${host}|https|`));
          assert.doesNotMatch(response.body, /spoofed|evil/);
        }
        for (const route of ['/ws', '/ws?ticket=fixture']) {
          assert.equal((await request(tlsPort, host, route, { Connection: 'Upgrade', Upgrade: 'websocket' })).status, 101);
        }
      }
      // La misma entrada valida proxy y maintenance antes de ejecutar nginx.
      for (const invalid of [
        ['APP_HOST=wrong.example.test'], ['API_HOST=*'], ['API_HOST=api.example.test;'],
        ['API_HOST=api.example.test\nother.example.test'],
        ['PUBLIC_ORIGIN=https://evil.example.test'], ['PUBLIC_ORIGIN=https://app.example.test/path'],
        [`PUBLIC_ORIGIN=https://${canonical}:65536`],
      ]) {
        const result = spawnSync('docker', ['exec', ...invalid.flatMap((v) => ['-e', v]), name,
          '/bin/sh', '/opt/rsp/start.sh'], { encoding: 'utf8', timeout: 5000 });
        assert.equal(result.status, 1, `${invalid}: ${result.stderr}`);
        assert.match(result.stderr, /APP_HOST|API_HOST|PUBLIC_ORIGIN/);
      }
    });
  }
});
