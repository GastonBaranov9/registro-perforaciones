import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { MainStore } from '../../shared/services/mainstore-service/main.store';
import { UsuarioPublico } from '../../shared/types/schemas';
import {
  isAdminGuard,
  isloggedGuard,
  isPerfOrAdminGuard,
  isPropGuard,
  nativeSessionGuard,
} from './islogged-guard-guard';
import { RuntimePlatformService } from '../native/runtime-platform.service';
import { AuthService, type AuthState } from '../../shared/services/auth-service/auth.service';

describe('guards de acceso', () => {
  let store: MainStore;
  let router: Router;
  const route = {} as ActivatedRouteSnapshot;
  const state = { url: '/recurso' } as RouterStateSnapshot;

  const usuarioConRol = (nombre: string): UsuarioPublico => ({
    id_usuario: 7,
    email: 'usuario@example.com',
    nombre: 'Usuario',
    activo: true,
    fecha_registro: '2026-01-01',
    roles: [{ id_rol: 99, nombre, descr: nombre }],
  });

  const ejecutar = (guard: typeof isloggedGuard): boolean | UrlTree =>
    TestBed.runInInjectionContext(() => guard(route, state)) as boolean | UrlTree;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    store = TestBed.inject(MainStore);
    router = TestBed.inject(Router);
  });

  it('redirige al login cuando no hay usuario autenticado', () => {
    const resultado = ejecutar(isloggedGuard);

    expect(resultado instanceof UrlTree).toBeTrue();
    expect(router.serializeUrl(resultado as UrlTree)).toBe('/login?redirectTo=%2Frecurso');
  });

  it('permite a un usuario autenticado', () => {
    store.user.set(usuarioConRol('propietario'));

    expect(ejecutar(isloggedGuard)).toBeTrue();
  });

  it('permite administracion en el guard administrativo', () => {
    store.user.set(usuarioConRol('administracion'));

    expect(ejecutar(isAdminGuard)).toBeTrue();
  });

  it('deniega un rol incorrecto en el guard administrativo', () => {
    store.user.set(usuarioConRol('propietario'));

    expect(router.serializeUrl(ejecutar(isAdminGuard) as UrlTree)).toBe(
      '/home?redirectTo=%2Frecurso',
    );
  });

  it('permite perforador y administracion en el guard tecnico', () => {
    store.user.set(usuarioConRol('perforador'));
    expect(ejecutar(isPerfOrAdminGuard)).toBeTrue();

    store.user.set(usuarioConRol('administracion'));
    expect(ejecutar(isPerfOrAdminGuard)).toBeTrue();
  });

  it('permite propietario en isPropGuard', () => {
    store.user.set(usuarioConRol('propietario'));

    expect(ejecutar(isPropGuard)).toBeTrue();
  });

  it('deniega perforador en isPropGuard', () => {
    store.user.set(usuarioConRol('perforador'));

    expect(router.serializeUrl(ejecutar(isPropGuard) as UrlTree)).toBe(
      '/home?redirectTo=%2Frecurso',
    );
  });
});

describe('nativeSessionGuard', () => {
  const route = {} as ActivatedRouteSnapshot;
  const routeState = { url: '/pozos-list' } as RouterStateSnapshot;
  let authState: AuthState;
  let bootstrap: jasmine.Spy;
  let router: Router;
  let runtimePlatform: 'android' | 'unknown';

  beforeEach(() => {
    authState = 'unauthenticated';
    runtimePlatform = 'android';
    bootstrap = jasmine.createSpy('bootstrap').and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: RuntimePlatformService, useValue: { platform: () => runtimePlatform, isNative: () => runtimePlatform === 'android' } },
        {
          provide: AuthService,
          useValue: { bootstrap: () => bootstrap(), state: () => authState },
        },
      ],
    });
    router = TestBed.inject(Router);
  });

  const ejecutarNative = () =>
    TestBed.runInInjectionContext(() => nativeSessionGuard(route, routeState)) as Promise<true | UrlTree>;

  it('espera bootstrap antes de permitir una sesión autenticada', async () => {
    let release!: () => void;
    bootstrap.and.returnValue(new Promise<void>((resolve) => { release = resolve; }));
    authState = 'authenticated';
    let completed = false;
    const result = ejecutarNative().then((value) => { completed = true; return value; });

    await Promise.resolve();
    expect(completed).toBeFalse();
    release();
    await expectAsync(result).toBeResolvedTo(true);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('redirige cada estado bloqueado sin habilitar negocio', async () => {
    const cases: Array<[AuthState, string]> = [
      ['unauthenticated', '/login?redirectTo=%2Fpozos-list'],
      ['upgrade-required', '/upgrade-required'],
      ['offline-unverified', '/session-unavailable?reason=offline'],
      ['logout-pending', '/session-unavailable?reason=logout-pending'],
      ['client-error', '/session-unavailable?reason=client-error'],
    ];

    for (const [state, expectedUrl] of cases) {
      authState = state;
      const result = await ejecutarNative();
      expect(router.serializeUrl(result as UrlTree)).toBe(expectedUrl);
    }
  });

  it('bloquea runtime desconocido con client-error', async () => {
    runtimePlatform = 'unknown';
    authState = 'client-error';
    const result = await ejecutarNative();
    expect(router.serializeUrl(result as UrlTree)).toBe('/session-unavailable?reason=client-error');
  });
});
