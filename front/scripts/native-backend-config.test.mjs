import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertProductionAppId,
  validateNativeBackendOrigin,
} from './native-backend-config.mjs';

test('acepta HTTPS explícito en development y production', () => {
  assert.equal(
    validateNativeBackendOrigin('https://api.example.invalid', 'development'),
    'https://api.example.invalid',
  );
  assert.equal(
    validateNativeBackendOrigin('https://api.release-readiness.uy:8443', 'production'),
    'https://api.release-readiness.uy:8443',
  );
});

test('rechaza origin ausente, HTTP, paths y credenciales', () => {
  for (const origin of [
    undefined,
    '',
    'http://api.example.invalid',
    'https://api.example.invalid/api',
    'https://user:pass@api.example.invalid',
    'https://api.example.invalid?x=1',
    'https://api.example.invalid/',
  ]) {
    assert.throws(() => validateNativeBackendOrigin(origin, 'development'));
  }
});

test('production rechaza localhost, IP, nombres staging/test y dominios reservados', () => {
  for (const origin of [
    'https://localhost',
    'https://api.localhost',
    'https://127.0.0.1',
    'https://10.0.0.4',
    'https://api-staging.release-readiness.uy',
    'https://test.api.release-readiness.uy',
    'https://api.perforaciones.invalid',
    'https://api.example',
    'https://api.example.test',
    'https://example.com',
    'https://api.example.com',
    'https://example.net',
    'https://api.example.org',
  ]) {
    assert.throws(() => validateNativeBackendOrigin(origin, 'production'));
  }
});

test('development conserva origins HTTPS reservados usados por fixtures locales', () => {
  for (const origin of [
    'https://api.perforaciones.invalid',
    'https://api.example',
    'https://api.example.test',
    'https://example.com',
    'https://localhost',
    'https://127.0.0.1',
  ]) {
    assert.equal(validateNativeBackendOrigin(origin, 'development'), origin);
  }
});

test('production bloquea el appId placeholder', () => {
  assert.throws(() => assertProductionAppId("appId: 'com.example.app'"));
  assert.doesNotThrow(() => assertProductionAppId("appId: 'uy.example.registro'"));
});
