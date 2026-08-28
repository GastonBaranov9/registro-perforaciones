import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CAPACITOR_RUNTIME } from '../../../core/native/native-plugin.tokens';
import { AuthService } from './auth.service';

const webUser = {
  id_usuario: 7,
  email: 'usuario@example.test',
  nombre: 'Usuario Web',
  activo: true,
  fecha_registro: '2026-01-01T00:00:00.000Z',
  roles: [{ id_rol: 1, nombre: 'administracion', descr: 'Administración' }],
};

describe('AuthService web', () => {
  let controller: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: CAPACITOR_RUNTIME,
          useValue: { getPlatform: () => 'web', isNativePlatform: () => false },
        },
      ],
    });
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('preserva login web POST+GET sin Bearer ni storage native', async () => {
    const service = TestBed.inject(AuthService);
    const login = service.logged('usuario@example.test', 'clave-web');

    controller.expectOne('/api/login').flush({ authenticated: true });
    await Promise.resolve();
    controller.expectOne('/api/login').flush(webUser);
    await login;

    expect(service.state()).toBe('authenticated');
    expect(service.userId()).toBe(7);
  });

  it('preserva bootstrap y logout web existentes', async () => {
    const service = TestBed.inject(AuthService);
    const bootstrap = service.bootstrap();
    controller.expectOne('/api/login').flush(webUser);
    await bootstrap;
    expect(service.state()).toBe('authenticated');

    const logout = service.logout();
    const request = controller.expectOne('/api/logout');
    expect(request.request.body).toBeNull();
    request.flush(null, { status: 204, statusText: 'No Content' });
    await logout;
    expect(service.state()).toBe('unauthenticated');
  });

  it('limita el bootstrap web si la sesión no responde', fakeAsync(() => {
    const service = TestBed.inject(AuthService);
    service.bootstrap();
    flushMicrotasks();
    controller.expectOne('/api/login');
    tick(10_001);
    flushMicrotasks();
    expect(service.state()).toBe('unauthenticated');
  }));
});
