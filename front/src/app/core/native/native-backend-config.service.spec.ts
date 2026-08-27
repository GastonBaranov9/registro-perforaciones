import { isWebApiRequest, validateNativeBackendOrigin } from './native-backend-config.service';

describe('configuración del backend native', () => {
  it('acepta un origin HTTPS exacto y rechaza paths/HTTP', () => {
    expect(validateNativeBackendOrigin('https://api.example.test', 'development').origin)
      .toBe('https://api.example.test');
    expect(() => validateNativeBackendOrigin('http://api.example.test', 'development')).toThrow();
    expect(() => validateNativeBackendOrigin('https://api.example.test/api', 'development')).toThrow();
  });

  it('production rechaza localhost, puertos/IP ajenos y staging', () => {
    for (const origin of ['https://localhost', 'https://127.0.0.1', 'https://api-staging.example.test']) {
      expect(() => validateNativeBackendOrigin(origin, 'production')).toThrow();
    }
  });

  it('el matcher web compara origin y path con URL parser', () => {
    expect(isWebApiRequest('/api/pozos', '/api/')).toBeTrue();
    expect(isWebApiRequest('https://example.evil/api/pozos', '/api/')).toBeFalse();
    expect(isWebApiRequest('/api-evil/pozos', '/api/')).toBeFalse();
  });
});
