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
    validateNativeBackendOrigin('https://api.example.invalid:8443', 'production'),
    'https://api.example.invalid:8443',
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

test('production rechaza localhost, IP y nombres staging/test', () => {
  for (const origin of [
    'https://localhost',
    'https://api.localhost',
    'https://127.0.0.1',
    'https://10.0.0.4',
    'https://api-staging.example.invalid',
    'https://test.api.example.invalid',
  ]) {
    assert.throws(() => validateNativeBackendOrigin(origin, 'production'));
  }
});

test('production bloquea el appId placeholder', () => {
  assert.throws(() => assertProductionAppId("appId: 'com.example.app'"));
  assert.doesNotThrow(() => assertProductionAppId("appId: 'uy.example.registro'"));
});
