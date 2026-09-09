import {
  isWebApiRequest,
  NativeBackendConfigService,
  validateNativeBackendOrigin,
} from './native-backend-config.service';

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

  it('separa las rutas auth native del prefijo de APIs normales', () => {
    const configured = new NativeBackendConfigService();
    (configured as unknown as { parsed: URL }).parsed = new URL('https://api.example.test');
    expect(configured.nativeAuthUrl('/auth/native/login')).toBe('https://api.example.test/auth/native/login');
    expect(configured.isAuthorizedNativeAuthRequest('https://api.example.test/auth/native/session')).toBeTrue();
    expect(configured.isAuthorizedNativeAuthRequest('https://api.example.test/api/pozos')).toBeFalse();
    expect(configured.isAuthorizedApiRequest('https://api.example.test/api/pozos')).toBeTrue();
    expect(configured.isAuthorizedApiRequest('https://api.example.test/auth/native/login')).toBeFalse();
  });
});
