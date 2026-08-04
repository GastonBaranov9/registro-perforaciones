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
} from './islogged-guard-guard';

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
