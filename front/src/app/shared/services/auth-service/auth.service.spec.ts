import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
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
const userB = {
  id_usuario: 8,
  nombre: 'Otra persona',
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
        {
          provide: NativeBackendConfigService,
          useValue: {
            origin: () => new URL('https://api.example.test'),
            nativeAuthUrl: (path: string) => new URL(path, 'https://api.example.test').toString(),
          },
        },
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
    const request = controller.expectOne('https://api.example.test/api/auth/native/login');
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
    controller.expectOne('https://api.example.test/api/auth/native/login').flush({
      token_type: 'Bearer', session_token: token, expires_at: expiration, user,
    });
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
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

    controller.expectNone('https://api.example.test/api/auth/native/login');
    expect(service.state()).toBe('client-error');
    expect(secure.set).not.toHaveBeenCalled();
  });

  it('respuesta parcial con token válido se revoca y nunca queda persistida', async () => {
    const service = TestBed.inject(AuthService);
    const promise = service.logged('user@example.test', 'password-secreto');
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/login').flush({
      token_type: 'Bearer', session_token: token, expires_at: 'fecha-inválida', user,
    });
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });

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

  it('session timeout libera bootstrap sin borrar token', fakeAsync(() => {
    storedSession();
    spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    const service = TestBed.inject(AuthService);
    service.bootstrap();
    flushMicrotasks();
    controller.expectOne('https://api.example.test/api/auth/native/session');
    tick(10_001);
    flushMicrotasks();
    expect(service.state()).toBe('offline-unverified');
    expect(secureRecord).not.toBeNull();
  }));

  it('restaura la misma sesión con build actual tras upgrade in-place', async () => {
    storedSession();
    const service = TestBed.inject(AuthService);
    const bootstrap = service.bootstrap();
    await settle();
    const request = controller.expectOne('https://api.example.test/api/auth/native/session');
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
    controller.expectOne('https://api.example.test/api/auth/native/session').flush(
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
    controller.expectOne('https://api.example.test/api/auth/native/session').flush(
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
          {
            provide: NativeBackendConfigService,
            useValue: {
              origin: () => new URL('https://api.example.test'),
              nativeAuthUrl: (path: string) => new URL(path, 'https://api.example.test').toString(),
            },
          },
        ],
      });
      controller = TestBed.inject(HttpTestingController);
      storedSession();
      const service = TestBed.inject(AuthService);
      const bootstrap = service.bootstrap();
      await settle();
      controller.expectOne('https://api.example.test/api/auth/native/session').flush(
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
    controller.expectNone('https://api.example.test/api/auth/native/session');
  });

  it('logout 204 limpia y error de red persiste logout-pending para restart', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    let logout = service.logout();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(
      { message: 'offline' }, { status: 0, statusText: 'Network Error' },
    );
    await logout;
    expect(service.state()).toBe('logout-pending');
    expect(preferenceValues.get('logout_pending_v1')).toBe(JSON.stringify({ pending: true, userId: 7 }));
    expect(secureRecord).not.toBeNull();

    logout = service.logout();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await logout;
    expect(service.state()).toBe('unauthenticated');
    expect(secureRecord).toBeNull();
    expect(preferenceValues.has('logout_pending_v1')).toBeFalse();
  });

  it('si no puede persistir pending conserva intacta la sesión y no llama logout remoto', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    preferences.set.and.callFake(async ({ key, value }) => {
      if (key === 'logout_pending_v1') throw new Error('Preferences no disponible');
      preferenceValues.set(key, value);
    });
    const secureClearCalls = secure.remove.calls.count();

    await expectAsync(service.logout()).toBeRejected();

    controller.expectNone('https://api.example.test/api/auth/native/logout');
    expect(service.state()).toBe('authenticated');
    expect(service.userId()).toBe(user.id_usuario);
    expect(secureRecord).toEqual({
      token,
      installationId: jasmine.stringMatching(/^[0-9a-f-]{36}$/i),
    });
    expect(secure.remove.calls.count()).toBe(secureClearCalls);
  });

  it('204 remoto permite cierre seguro aunque falle borrar el token durable', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    secure.remove.and.rejectWith(new Error('Keychain no disponible'));

    const logout = service.logout();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(
      null,
      { status: 204, statusText: 'No Content' },
    );
    await logout;

    expect(service.state()).toBe('unauthenticated');
    expect(service.userId()).toBeNull();
    expect(secureRecord).not.toBeNull();

    const restart = service.bootstrap();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/session').flush(
      { code: 'ERR4_T05' },
      { status: 401, statusText: 'Unauthorized' },
    );
    await restart;
    expect(service.state()).toBe('unauthenticated');
    expect(service.userId()).toBeNull();
  });

  it('startup pending reintenta logout antes que session', async () => {
    storedSession();
    preferenceValues.set('logout_pending_v1', JSON.stringify({ pending: true, userId: 7 }));
    const service = TestBed.inject(AuthService);
    const bootstrap = service.bootstrap();
    await settle();
    controller.expectNone('https://api.example.test/api/auth/native/session');
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await bootstrap;
    expect(service.state()).toBe('unauthenticated');
  });

  it('timeout de pending logout libera bootstrap y conserva token+marker para retry', fakeAsync(() => {
    storedSession();
    preferenceValues.set('logout_pending_v1', JSON.stringify({ pending: true, userId: 7 }));
    const service = TestBed.inject(AuthService);
    let completed = false;
    void service.bootstrap().then(() => { completed = true; });
    flushMicrotasks();
    const blackholed = controller.expectOne('https://api.example.test/api/auth/native/logout');
    controller.expectNone('https://api.example.test/api/auth/native/session');

    tick(10_001);
    flushMicrotasks();

    expect(completed).toBeTrue();
    expect(blackholed.cancelled).toBeTrue();
    expect(service.state()).toBe('logout-pending');
    expect(secureRecord).toEqual({ token, installationId });
    expect(preferenceValues.get('logout_pending_v1')).toBe(
      JSON.stringify({ pending: true, userId: 7 }),
    );

    const retry = service.logout();
    flushMicrotasks();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(
      null,
      { status: 204, statusText: 'No Content' },
    );
    flushMicrotasks();
    void retry;
    expect(service.state()).toBe('unauthenticated');
  }));

  it('logout-all 401 libera el lock y permite login y logout posteriores', async () => {
    const replacementToken = `rspn1_${'H'.repeat(43)}`;
    const service = TestBed.inject(AuthService);
    await login(service);

    const logoutAll = service.logoutAll();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout-all').flush(
      { code: 'ERR4_T05' },
      { status: 401, statusText: 'Unauthorized' },
    );
    await logoutAll;
    expect(service.state()).toBe('unauthenticated');

    const replacement = service.logged('other@example.test', 'password-nueva');
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/login').flush({
      token_type: 'Bearer',
      session_token: replacementToken,
      expires_at: expiration,
      user: userB,
    });
    await replacement;
    expect(service.state()).toBe('authenticated');

    const logout = service.logout();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(
      null,
      { status: 204, statusText: 'No Content' },
    );
    await logout;
    expect(service.state()).toBe('unauthenticated');
  });

  it('fallo de lifecycle retira usuario y ruta protegida sin borrar token', async () => {
    storedSession();
    app.addListener.and.rejectWith(new Error('listener no disponible'));
    const router = TestBed.inject(Router);
    const navigation = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    const service = TestBed.inject(AuthService);

    const bootstrap = service.bootstrap();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/session').flush({ user, expires_at: expiration });
    await bootstrap;
    await settle();

    expect(service.state()).toBe('client-error');
    expect(service.userId()).toBeNull();
    expect(secureRecord).toEqual({ token, installationId });
    expect(navigation).toHaveBeenCalledOnceWith('/session-unavailable?reason=client-error');
  });

  it('fallo de lifecycle no navega en loop si ya está en session-unavailable', async () => {
    storedSession();
    app.addListener.and.rejectWith(new Error('listener no disponible'));
    const router = TestBed.inject(Router);
    spyOnProperty(router, 'url', 'get').and.returnValue(
      '/session-unavailable?reason=client-error',
    );
    const navigation = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    const service = TestBed.inject(AuthService);

    const bootstrap = service.bootstrap();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/session').flush({ user, expires_at: expiration });
    await bootstrap;
    await settle();

    expect(service.state()).toBe('client-error');
    expect(service.userId()).toBeNull();
    expect(secureRecord).toEqual({ token, installationId });
    expect(navigation).not.toHaveBeenCalled();
  });

  it('marker pending huérfano sin token no bloquea bootstrap ni llama session', async () => {
    preferenceValues.set('logout_pending_v1', JSON.stringify({ pending: true, userId: 7 }));
    const service = TestBed.inject(AuthService);
    await service.bootstrap();
    expect(service.state()).toBe('unauthenticated');
    controller.expectNone('https://api.example.test/api/auth/native/session');
    expect(preferenceValues.has('logout_pending_v1')).toBeFalse();
  });

  it('resume después del umbral revalida una vez y respeta logout-pending', async () => {
    storedSession();
    const service = TestBed.inject(AuthService);
    const bootstrap = service.bootstrap();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/session').flush({ user, expires_at: expiration });
    await bootstrap;

    await service.handleAppStateChange(false, 1_000);
    const firstResume = service.handleAppStateChange(true, 301_001);
    const duplicateResume = service.handleAppStateChange(true, 301_002);
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/session').flush({ user, expires_at: expiration });
    await Promise.all([firstResume, duplicateResume]);
    expect(service.state()).toBe('authenticated');
  });

  it('resume aplica 401 autoritativo y limpia la sesión', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/session').flush(
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
    controller.expectOne('https://api.example.test/api/auth/native/session').flush(
      { code: 'NATIVE_APP_UPGRADE_REQUIRED' }, { status: 426, statusText: 'Upgrade Required' },
    );
    await resume;
    expect(service.state()).toBe('upgrade-required');
    expect(secureRecord).not.toBeNull();
  });

  it('resume con error de red conserva token como offline-unverified', async () => {
    const service = TestBed.inject(AuthService);
    const navigation = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    await login(service);
    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/session').flush(
      { code: 'OFFLINE' }, { status: 0, statusText: 'Network Error' },
    );
    await resume;
    expect(service.state()).toBe('offline-unverified');
    expect(secureRecord).not.toBeNull();
    expect(navigation).toHaveBeenCalledWith('/session-unavailable?reason=offline');
  });

  it('resume prioriza retry de logout-pending y no llama session', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    const logout = service.logout();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(
      { code: 'OFFLINE' }, { status: 0, statusText: 'Network Error' },
    );
    await logout;

    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    controller.expectNone('https://api.example.test/api/auth/native/session');
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
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

  it('login fallido no cancela logout-pending ni vuelve utilizable el token viejo', async () => {
    storedSession();
    preferenceValues.set('logout_pending_v1', JSON.stringify({ pending: true, userId: 7 }));
    const service = TestBed.inject(AuthService);
    const bootstrap = service.bootstrap();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(
      { code: 'OFFLINE' }, { status: 0, statusText: 'Network Error' },
    );
    await bootstrap;
    expect(service.state()).toBe('logout-pending');
    const login = service.logged('new@example.test', 'bad-password');
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/login').flush(
      { code: 'INVALID_CREDENTIALS' }, { status: 401, statusText: 'Unauthorized' },
    );
    await expectAsync(login).toBeRejected();
    expect(service.state()).toBe('unauthenticated');
    expect(preferenceValues.has('logout_pending_v1')).toBeFalse();
    expect(secureRecord).toBeNull();
  });

  it('login exitoso de reemplazo persiste el token nuevo antes de limpiar pending', async () => {
    const replacementToken = `rspn1_${'B'.repeat(43)}`;
    storedSession();
    preferenceValues.set('logout_pending_v1', JSON.stringify({ pending: true, userId: 7 }));
    const service = TestBed.inject(AuthService);
    const bootstrap = service.bootstrap();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(
      { code: 'OFFLINE' }, { status: 0, statusText: 'Network Error' },
    );
    await bootstrap;
    const login = service.logged('new@example.test', 'good-password');
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/login').flush({
      token_type: 'Bearer', session_token: replacementToken, expires_at: expiration, user,
    });
    await login;
    expect(service.state()).toBe('authenticated');
    expect(secureRecord).toEqual({ token: replacementToken, installationId: jasmine.stringMatching(/^[0-9a-f-]{36}$/i) });
    expect(preferenceValues.has('logout_pending_v1')).toBeFalse();
  });

  it('probe de Preferences fallido bloquea login antes de crear sesión remota', async () => {
    preferences.set.and.callFake(async ({ key, value }) => {
      if (key === 'native_storage_probe_v1') throw new Error('write unavailable');
      preferenceValues.set(key, value);
    });
    const service = TestBed.inject(AuthService);
    await expectAsync(service.logged('user@example.test', 'password-secreto')).toBeRejected();
    controller.expectNone('https://api.example.test/api/auth/native/login');
    expect(service.state()).toBe('client-error');
  });
  it('probe fallido no promueve offline-unverified a authenticated', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/session').flush(
      { code: 'OFFLINE' }, { status: 0, statusText: 'Network Error' },
    );
    await resume;
    expect(service.state()).toBe('offline-unverified');

    preferences.set.and.callFake(async ({ key, value }) => {
      if (key === 'native_storage_probe_v1') throw new Error('probe unavailable');
      preferenceValues.set(key, value);
    });
    await expectAsync(service.logged('other@example.test', 'password')).toBeRejected();
    controller.expectNone('https://api.example.test/api/auth/native/logout');
    controller.expectNone('https://api.example.test/api/auth/native/login');
    expect(service.state()).toBe('offline-unverified');
    expect(secureRecord).not.toBeNull();
  });

  it('probe fallido no promueve upgrade-required a authenticated', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/session').flush(
      { code: 'NATIVE_APP_UPGRADE_REQUIRED' }, { status: 426, statusText: 'Upgrade Required' },
    );
    await resume;
    expect(service.state()).toBe('upgrade-required');

    preferences.set.and.callFake(async ({ key, value }) => {
      if (key === 'native_storage_probe_v1') throw new Error('probe unavailable');
      preferenceValues.set(key, value);
    });
    await expectAsync(service.logged('other@example.test', 'password')).toBeRejected();
    controller.expectNone('https://api.example.test/api/auth/native/logout');
    controller.expectNone('https://api.example.test/api/auth/native/login');
    expect(service.state()).toBe('upgrade-required');
    expect(secureRecord).not.toBeNull();
  });

  it('204 remoto deja unauthenticated aunque falle el clear del pending marker', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    preferenceValues.set('logout_pending_v1', JSON.stringify({ pending: true, userId: 7 }));
    preferences.remove.and.callFake(async ({ key }) => {
      if (key === 'logout_pending_v1') throw new Error('marker no disponible');
      preferenceValues.delete(key);
    });

    const logout = service.logout();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await logout;

    expect(service.state()).toBe('unauthenticated');
    expect(secureRecord).toBeNull();
    expect(service.nativeRequestAuthSnapshot('/api/pozos')).toBeNull();
  });

  it('ignora respuestas stale de session tras reemplazar A por B', async () => {
    const replacementToken = `rspn1_${'B'.repeat(43)}`;
    const service = TestBed.inject(AuthService);
    await login(service);

    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    const sessionRequest = controller.expectOne('https://api.example.test/api/auth/native/session');

    const replacement = service.logged('other@example.test', 'password-nueva');
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/login').flush({
      token_type: 'Bearer', session_token: replacementToken, expires_at: expiration, user: userB,
    });
    await replacement;

    sessionRequest.flush({ user, expires_at: expiration });
    await resume;
    expect(service.state()).toBe('authenticated');
    expect(service.userId()).toBe(userB.id_usuario);
    expect(secureRecord).toEqual({ token: replacementToken, installationId: jasmine.stringMatching(/^[0-9a-f-]{36}$/i) });
  });

  it('ignora 401 y errores stale de session sin destruir B', async () => {
    const replacementToken = `rspn1_${'B'.repeat(43)}`;
    const service = TestBed.inject(AuthService);
    await login(service);
    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    const sessionRequest = controller.expectOne('https://api.example.test/api/auth/native/session');

    const replacement = service.logged('other@example.test', 'password-nueva');
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/login').flush({
      token_type: 'Bearer', session_token: replacementToken, expires_at: expiration, user: userB,
    });
    await replacement;

    sessionRequest.flush({ code: 'ERR4_T05' }, { status: 401, statusText: 'Unauthorized' });
    await resume;
    expect(service.state()).toBe('authenticated');
    expect(service.userId()).toBe(userB.id_usuario);
    expect(secureRecord).toEqual({ token: replacementToken, installationId: jasmine.stringMatching(/^[0-9a-f-]{36}$/i) });
  });

  it('ignora network error stale después de login B y mantiene authenticated', async () => {
    const replacementToken = `rspn1_${'C'.repeat(43)}`;
    const service = TestBed.inject(AuthService);
    await login(service);
    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    const sessionRequest = controller.expectOne('https://api.example.test/api/auth/native/session');

    const replacement = service.logged('other@example.test', 'password-nueva');
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/login').flush({
      token_type: 'Bearer', session_token: replacementToken, expires_at: expiration, user: userB,
    });
    await replacement;

    sessionRequest.flush({ code: 'OFFLINE' }, { status: 0, statusText: 'Network Error' });
    await resume;
    expect(service.state()).toBe('authenticated');
    expect(service.userId()).toBe(userB.id_usuario);
    expect(secureRecord).toEqual({ token: replacementToken, installationId: jasmine.stringMatching(/^[0-9a-f-]{36}$/i) });
  });

  it('ignora respuesta stale de session después de logout', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);
    await service.handleAppStateChange(false, 1_000);
    const resume = service.handleAppStateChange(true, 301_001);
    await settle();
    const sessionRequest = controller.expectOne('https://api.example.test/api/auth/native/session');

    const logout = service.logout();
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await logout;
    sessionRequest.flush({ user, expires_at: expiration });
    await resume;
    expect(service.state()).toBe('unauthenticated');
    expect(service.userId()).toBeNull();
    expect(secureRecord).toBeNull();
  });

  it('revoca A antes de enviar login B y no deja dos sesiones controladas', async () => {
    const replacementToken = `rspn1_${'D'.repeat(43)}`;
    const service = TestBed.inject(AuthService);
    await login(service);

    const replacement = service.logged('other@example.test', 'password-nueva');
    await settle();
    controller.expectNone('https://api.example.test/api/auth/native/login');
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/login').flush({
      token_type: 'Bearer', session_token: replacementToken, expires_at: expiration, user: userB,
    });
    await replacement;

    expect(service.state()).toBe('authenticated');
    expect(service.userId()).toBe(userB.id_usuario);
    expect(secureRecord).toEqual({ token: replacementToken, installationId: jasmine.stringMatching(/^[0-9a-f-]{36}$/i) });
  });

  it('si falla la revocaciÃ³n de A, no envÃ­a login B y conserva A pendiente', async () => {
    const service = TestBed.inject(AuthService);
    await login(service);

    const replacement = service.logged('other@example.test', 'password-nueva');
    await settle();
    controller.expectOne('https://api.example.test/api/auth/native/logout').flush(
      { code: 'OFFLINE' }, { status: 0, statusText: 'Network Error' },
    );
    await expectAsync(replacement).toBeRejected();

    controller.expectNone('https://api.example.test/api/auth/native/login');
    expect(service.state()).toBe('logout-pending');
    expect(secureRecord).toEqual({ token, installationId: jasmine.stringMatching(/^[0-9a-f-]{36}$/i) });
    expect(preferenceValues.get('logout_pending_v1')).toBe(JSON.stringify({ pending: true, userId: 7 }));
  });

  it('serializa logout pending A antes de iniciar login B', async () => {
    const replacementToken = `rspn1_${'E'.repeat(43)}`;
    const service = TestBed.inject(AuthService);
    await login(service);

    const logout = service.logout();
    await settle();
    const logoutRequest = controller.expectOne('https://api.example.test/api/auth/native/logout');
    const replacement = service.logged('other@example.test', 'password-nueva');
    await settle();
    controller.expectNone('https://api.example.test/api/auth/native/login');

    logoutRequest.flush(null, { status: 204, statusText: 'No Content' });
    await logout;
    await settle();
    const loginRequest = controller.expectOne('https://api.example.test/api/auth/native/login');
    loginRequest.flush({
      token_type: 'Bearer', session_token: replacementToken, expires_at: expiration, user: userB,
    });
    await replacement;
    expect(service.state()).toBe('authenticated');
    expect(service.userId()).toBe(userB.id_usuario);
  });

  it('serializa invalidación 401 con login y conserva B', async () => {
    const replacementToken = `rspn1_${'F'.repeat(43)}`;
    const service = TestBed.inject(AuthService);
    await login(service);
    let releaseStorage!: () => void;
    const storageCleanup = new Promise<void>((resolve) => { releaseStorage = resolve; });
    secure.remove.and.callFake(async () => storageCleanup.then(() => { secureRecord = null; return true; }));

    const invalidation = service.handleNative401(1);
    await settle();
    const replacement = service.logged('other@example.test', 'password-nueva');
    await settle();
    controller.expectNone('https://api.example.test/api/auth/native/login');

    releaseStorage();
    await invalidation;
    await settle();
    const loginRequest = controller.expectOne('https://api.example.test/api/auth/native/login');
    loginRequest.flush({
      token_type: 'Bearer', session_token: replacementToken, expires_at: expiration, user: userB,
    });
    await replacement;
    expect(service.state()).toBe('authenticated');
    expect(service.userId()).toBe(userB.id_usuario);
  });

  it('una invalidación stale posterior al login no toca la sesión nueva', async () => {
    const replacementToken = `rspn1_${'G'.repeat(43)}`;
    const service = TestBed.inject(AuthService);
    await login(service);
    const oldGeneration = service.nativeRequestAuthSnapshot('/api/pozos')?.generation;
    const replacement = service.logged('other@example.test', 'password-nueva');
    await settle();
    const logoutRequest = controller.expectOne('https://api.example.test/api/auth/native/logout');
    const invalidation = service.handleNative401(oldGeneration);
    logoutRequest.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    const loginRequest = controller.expectOne('https://api.example.test/api/auth/native/login');
    loginRequest.flush({
      token_type: 'Bearer', session_token: replacementToken, expires_at: expiration, user: userB,
    });
    await replacement;
    await invalidation;
    expect(service.state()).toBe('authenticated');
    expect(service.userId()).toBe(userB.id_usuario);
    expect(secureRecord).toEqual({ token: replacementToken, installationId: jasmine.stringMatching(/^[0-9a-f-]{36}$/i) });
  });
});
