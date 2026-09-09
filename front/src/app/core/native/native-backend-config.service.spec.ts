import {
  isWebApiRequest,
  NATIVE_AUTH_PUBLIC_PATHS,
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

  it('construye el contrato auth native publico bajo /api', () => {
    const configured = new NativeBackendConfigService();
    (configured as unknown as { parsed: URL }).parsed = new URL('https://api.example.test');

    expect(configured.nativeAuthUrl(NATIVE_AUTH_PUBLIC_PATHS.login))
      .toBe('https://api.example.test/api/auth/native/login');
    expect(configured.nativeAuthUrl(NATIVE_AUTH_PUBLIC_PATHS.session))
      .toBe('https://api.example.test/api/auth/native/session');
    expect(configured.nativeAuthUrl(NATIVE_AUTH_PUBLIC_PATHS.logout))
      .toBe('https://api.example.test/api/auth/native/logout');
    expect(configured.nativeAuthUrl(NATIVE_AUTH_PUBLIC_PATHS.logoutAll))
      .toBe('https://api.example.test/api/auth/native/logout-all');
    expect(configured.nativeAuthUrl(NATIVE_AUTH_PUBLIC_PATHS.wsTicket))
      .toBe('https://api.example.test/api/auth/native/ws-ticket');
  });

  it('autoriza solo endpoints auth native publicos exactos del origin configurado', () => {
    const configured = new NativeBackendConfigService();
    (configured as unknown as { parsed: URL }).parsed = new URL('https://api.example.test');

    expect(configured.isAuthorizedNativeAuthRequest('https://api.example.test/api/auth/native/session')).toBeTrue();
    expect(configured.isAuthorizedNativeAuthRequest('https://api.example.test/api/auth/native/logout')).toBeTrue();
    expect(configured.isAuthorizedNativeAuthRequest('https://api.example.test/auth/native/session')).toBeFalse();
    expect(configured.isAuthorizedNativeAuthRequest('https://evil.example/api/auth/native/session')).toBeFalse();
    expect(configured.isAuthorizedNativeAuthRequest('https://api.example.test/api-evil/auth/native/session')).toBeFalse();
    expect(configured.isAuthorizedNativeAuthRequest('https://api.example.test/api/auth/native/session/extra')).toBeFalse();
    expect(configured.isAuthorizedNativeAuthRequest('https://api.example.test/api/pozos')).toBeFalse();
    expect(configured.isAuthorizedApiRequest('https://api.example.test/api/pozos')).toBeTrue();
    expect(configured.isAuthorizedApiRequest('https://api.example.test/api/auth/native/session')).toBeFalse();
    expect(configured.isAuthorizedApiRequest('https://api.example.test/api/auth/native/session/extra')).toBeFalse();
    expect(configured.isAuthorizedApiRequest('https://api.example.test/auth/native/login')).toBeFalse();
  });
});
