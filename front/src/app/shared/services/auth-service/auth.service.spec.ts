import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { KeychainAccess } from '@aparajita/capacitor-secure-storage';
import { NativeBackendConfigService } from '../../../core/native/native-backend-config.service';
import {
  CAPACITOR_APP,
  CAPACITOR_PREFERENCES,
  CAPACITOR_RUNTIME,
  CAPACITOR_SECURE_STORAGE,
  type NativeAppApi,
  type NativePreferencesApi,
  type NativeSecureStorageApi,
} from '../../../core/native/native-plugin.tokens';
import { AuthService } from './auth.service';

const token = `rspn1_${'A'.repeat(43)}`;
const installationId = '123e4567-e89b-42d3-a456-426614174000';
const otherInstallationId = '123e4567-e89b-42d3-b456-426614174001';
const user = {
  id_usuario: 7,
  nombre: 'Perforador',
  roles: [{ id_rol: 2, nombre: 'perforador', descr: 'Perforador' }],
};
const expiration = '2026-09-20T12:00:00.000Z';

describe('AuthService native', () => {
  let controller: HttpTestingController;
  let secure: jasmine.SpyObj<NativeSecureStorageApi>;
  let preferences: jasmine.SpyObj<NativePreferencesApi>;
  let app: jasmine.SpyObj<NativeAppApi>;
  let secureRecord: unknown;
  let preferenceValues: Map<string, string>;

  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    secureRecord = null;
    preferenceValues = new Map();
    secure = jasmine.createSpyObj<NativeSecureStorageApi>('secure', [
      'setSynchronize', 'setDefaultKeychainAccess', 'setKeyPrefix', 'get', 'set', 'remove',
    ]);
    secure.setSynchronize.and.resolveTo();
    secure.setDefaultKeychainAccess.and.resolveTo();
    secure.setKeyPrefix.and.resolveTo();
    secure.get.and.callFake(async () => secureRecord as never);
    secure.set.and.callFake(async (_key, value) => { secureRecord = value; });
    secure.remove.and.callFake(async () => { secureRecord = null; return true; });

    preferences = jasmine.createSpyObj<NativePreferencesApi>('preferences', [
      'configure', 'get', 'set', 'remove',
    ]);
    preferences.configure.and.resolveTo();
    preferences.get.and.callFake(async ({ key }) => ({ value: preferenceValues.get(key) ?? null }));
    preferences.set.and.callFake(async ({ key, value }) => { preferenceValues.set(key, value); });
    preferences.remove.and.callFake(async ({ key }) => { preferenceValues.delete(key); });

    app = jasmine.createSpyObj<NativeAppApi>('app', ['getInfo', 'addListener']);
    app.getInfo.and.resolveTo({ name: 'front', id: 'com.example.app', build: '120', version: '1.4.2' });
    app.addListener.and.resolveTo({ remove: async () => undefined });

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: CAPACITOR_RUNTIME, useValue: { getPlatform: () => 'android', isNativePlatform: () => true } },
        { provide: CAPACITOR_APP, useValue: app },
        { provide: CAPACITOR_SECURE_STORAGE, useValue: secure },
        { provide: CAPACITOR_PREFERENCES, useValue: preferences },
        { provide: NativeBackendConfigService, useValue: { origin: () => new URL('https://api.example.test') } },
      ],
    });
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  function storedSession(binding = installationId) {
    secureRecord = { token, installationId: binding };
    preferenceValues.set('installation_id_v1', installationId);
  }

  async function login(service: AuthService) {
    const promise = service.logged('user@example.test', 'password-secreto');
    await settle();
    const request = controller.expectOne('/api/auth/native/login');
    request.flush({
      token_type: 'Bearer', session_token: token, expires_at: expiration, user,
    });
    await promise;
    return request;
  }

  it('login envía DTO real, persiste token+binding juntos y no usa storage web', async () => {
    const localStorageWrite = spyOn(localStorage, 'setItem').and.callThrough();
    const service = TestBed.inject(AuthService);
    const request = await login(service);

    expect(request.request.body).toEqual({
      email: 'user@example.test',
      password: 'password-secreto',
      installation_id: jasmine.stringMatching(/^[0-9a-f-]{36}$/i),
    });
    expect(secure.set).toHaveBeenCalledWith(
      'native_session_v1',
      { token, installationId: jasmine.stringMatching(/^[0-9a-f-]{36}$/i) },
      false,
      false,
      KeychainAccess.whenUnlockedThisDeviceOnly,
    );
    expect(service.state()).toBe('authenticated');
    expect(localStorageWrite).not.toHaveBeenCalled();
  });

  it('secure storage failure compensa con logout best-effort y no autentica', async () => {
    secure.set.and.rejectWith(new Error('keystore no disponible'));
    const service = TestBed.inject(AuthService);
    const promise = service.logged('user@example.test', 'password-secreto');
    await settle();
    controller.expectOne('/api/auth/native/login').flush({
      token_type: 'Bearer', session_token: token, expires_at: expiration, user,
    });
    await settle();
    controller.expectOne('/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await expectAsync(promise).toBeRejected();
    expect(service.state()).toBe('client-error');
    expect(secureRecord).toBeNull();
  });

  it('Preferences failure bloquea login antes de crear una sesión remota', async () => {
    preferenceValues.set('installation_id_v1', installationId);
    preferences.remove.and.callFake(async ({ key }) => {
      if (key === 'logout_pending_v1') throw new Error('Preferences no disponible');
      preferenceValues.delete(key);
    });
    const service = TestBed.inject(AuthService);

    await expectAsync(service.logged('user@example.test', 'password-secreto')).toBeRejected();

    controller.expectNone('/api/auth/native/login');
    expect(service.state()).toBe('client-error');
    expect(secure.set).not.toHaveBeenCalled();
  });

  it('respuesta parcial con token válido se revoca y nunca queda persistida', async () => {
    const service = TestBed.inject(AuthService);
    const promise = service.logged('user@example.test', 'password-secreto');
    await settle();
    controller.expectOne('/api/auth/native/login').flush({
      token_type: 'Bearer', session_token: token, expires_at: 'fecha-inválida', user,
    });
    await settle();
    controller.expectOne('/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });

    await expectAsync(promise).toBeRejected();
    expect(service.state()).toBe('client-error');
    expect(secureRecord).toBeNull();
    expect(secure.set).not.toHaveBeenCalled();
  });

  it('no token al startup queda unauthenticated y bootstrap es single-flight', async () => {
    const service = TestBed.inject(AuthService);
    const first = service.bootstrap();
    const second = service.bootstrap();
    expect(first).toBe(second);
    await first;
    expect(service.state()).toBe('unauthenticated');
    expect(preferenceValues.get('installation_id_v1')).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('restaura la misma sesión con build actual tras upgrade in-place', async () => {
    storedSession();
    const service = TestBed.inject(AuthService);
    const bootstrap = service.bootstrap();
    await settle();
    const request = controller.expectOne('/api/auth/native/session');
    request.flush({ user, expires_at: expiration });
    await bootstrap;
    expect(service.state()).toBe('authenticated');
    expect(service.userId()).toBe(7);
    expect(app.getInfo).toHaveBeenCalledTimes(1);
    expect(secure.remove).not.toHaveBeenCalled();
  });

  it('401 autoritativo limpia token, 426 lo conserva y red bloquea sin borrarlo', async () => {
    storedSession();
    let service = TestBed.inject(AuthService);
    let bootstrap = service.bootstrap();
    await settle();
    controller.expectOne('/api/auth/native/session').flush(
      { code: 'ERR4_T05' }, { status: 401, statusText: 'Unauthorized' },
    );
    await bootstrap;
    expect(service.state()).toBe('unauthenticated');
    expect(secureRecord).toBeNull();
  });

  it('426 en restore conserva secure storage y entra upgrade-required', async () => {
    storedSession();
    const service = TestBed.inject(AuthService);
    const bootstrap = service.bootstrap();
    await settle();
    controller.expectOne('/api/auth/native/session').flush(
      { code: 'NATIVE_APP_UPGRADE_REQUIRED' }, { status: 426, statusText: 'Upgrade Required' },
    );
    await bootstrap;
    expect(service.state()).toBe('upgrade-required');
    expect(secureRecord).toEqual({ token, installationId });
  });

  it('errores de red y 5xx conservan token como offline-unverified', async () => {
    for (const status of [0, 503]) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
          { provide: CAPACITOR_RUNTIME, useValue: { getPlatform: () => 'android', isNativePlatform: () => true } },
          { provide: CAPACITOR_APP, useValue: app },
          { provide: CAPACITOR_SECURE_STORAGE, useValue: secure },
          { provide: CAPACITOR_PREFERENCES, useValue: preferences },
          { provide: NativeBackendConfigService, useValue: { origin: () => new URL('https://api.example.test') } },
        ],
      });
      controller = TestBed.inject(HttpTestingController);
      storedSession();
      const service = TestBed.inject(AuthService);
      const bootstrap = service.bootstrap();
      await settle();
      controller.expectOne('/api/auth/native/session').flush(
        { code: 'TEMPORARY' }, { status, statusText: status === 0 ? 'Network Error' : 'Unavailable' },
      );
      await bootstrap;
      expect(service.state()).toBe('offline-unverified');
      expect(secureRecord).toEqual({ token, installationId });
      controller.verify();
    }
  });

  it('binding residual distinto limpia token y exige login sin llamar session', async () => {
    storedSession(otherInstallationId);
    const service = TestBed.inject(AuthService);
    await service.bootstrap();
    expect(service.state()).toBe('unauthenticated');
    expect(secureRecord).toBeNull();
    controller.expectNone('/api/auth/native/session');
  });

  it('logout 204 limpia y error de red persiste logout-pending para restart', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    let logout = service.logout();
    await settle();
    controller.expectOne('/api/auth/native/logout').flush(
      { message: 'offline' }, { status: 0, statusText: 'Network Error' },
    );
    await logout;
    expect(service.state()).toBe('logout-pending');
    expect(preferenceValues.get('logout_pending_v1')).toBe('true');
    expect(secureRecord).not.toBeNull();

    logout = service.logout();
    await settle();
    controller.expectOne('/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await logout;
    expect(service.state()).toBe('unauthenticated');
    expect(secureRecord).toBeNull();
    expect(preferenceValues.has('logout_pending_v1')).toBeFalse();
  });

  it('startup pending reintenta logout antes que session', async () => {
    storedSession();
    preferenceValues.set('logout_pending_v1', 'true');
    const service = TestBed.inject(AuthService);
    const bootstrap = service.bootstrap();
    await settle();
    controller.expectNone('/api/auth/native/session');
    controller.expectOne('/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await bootstrap;
    expect(service.state()).toBe('unauthenticated');
  });

  it('resume después del umbral revalida una vez y respeta logout-pending', async () => {
    storedSession();
    const service = TestBed.inject(AuthService);
    const bootstrap = service.bootstrap();
    await settle();
    controller.expectOne('/api/auth/native/session').flush({ user, expires_at: expiration });
    await bootstrap;

    await service.handleAppStateChange(false, 1_000);
    const firstResume = service.handleAppStateChange(true, 301_001);
    const duplicateResume = service.handleAppStateChange(true, 301_002);
    await settle();
    controller.expectOne('/api/auth/native/session').flush({ user, expires_at: expiration });
    await Promise.all([firstResume, duplicateResume]);
    expect(service.state()).toBe('authenticated');
  });

  it('resume aplica 401 autoritativo y limpia la sesión', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    controller.expectOne('/api/auth/native/session').flush(
      { code: 'ERR4_T05' }, { status: 401, statusText: 'Unauthorized' },
    );
    await resume;
    expect(service.state()).toBe('unauthenticated');
    expect(secureRecord).toBeNull();
  });

  it('resume aplica 426 conservando el token', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    controller.expectOne('/api/auth/native/session').flush(
      { code: 'NATIVE_APP_UPGRADE_REQUIRED' }, { status: 426, statusText: 'Upgrade Required' },
    );
    await resume;
    expect(service.state()).toBe('upgrade-required');
    expect(secureRecord).not.toBeNull();
  });

  it('resume con error de red conserva token como offline-unverified', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    controller.expectOne('/api/auth/native/session').flush(
      { code: 'OFFLINE' }, { status: 0, statusText: 'Network Error' },
    );
    await resume;
    expect(service.state()).toBe('offline-unverified');
    expect(secureRecord).not.toBeNull();
  });

  it('resume prioriza retry de logout-pending y no llama session', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    const logout = service.logout();
    await settle();
    controller.expectOne('/api/auth/native/logout').flush(
      { code: 'OFFLINE' }, { status: 0, statusText: 'Network Error' },
    );
    await logout;

    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    controller.expectNone('/api/auth/native/session');
    controller.expectOne('/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await resume;
    expect(service.state()).toBe('unauthenticated');
  });

  it('varios 401 comparten una sola limpieza y navegación lógica', async () => {
    const service = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    const navigation = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    await Promise.all([service.handleNative401(), service.handleNative401(), service.handleNative401()]);
    expect(secure.remove).toHaveBeenCalledTimes(1);
    expect(navigation).toHaveBeenCalledTimes(1);
  });
});
