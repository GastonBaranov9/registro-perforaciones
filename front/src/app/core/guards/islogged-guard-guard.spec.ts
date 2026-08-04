import { signal } from '@angular/core';
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
import { isPropGuard } from './islogged-guard-guard';

describe('isPropGuard', () => {
  const ejecutarGuard = (usuario: UsuarioPublico): boolean | UrlTree => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: MainStore,
          useValue: { user: signal<UsuarioPublico | null>(usuario) },
        },
      ],
    });

    return TestBed.runInInjectionContext(
      () =>
        isPropGuard(
          {} as ActivatedRouteSnapshot,
          { url: '/ruta-propietario' } as RouterStateSnapshot
        ) as boolean | UrlTree
    );
  };

  const usuarioConRol = (nombreRol: string): UsuarioPublico => ({
    id_usuario: 7,
    email: 'usuario@example.com',
    nombre: 'Usuario',
    activo: true,
    fecha_registro: '2026-01-01T00:00:00.000Z',
    roles: [{ id_rol: 42, nombre: nombreRol, descr: nombreRol }],
  });

  it('permite un usuario propietario', () => {
    expect(ejecutarGuard(usuarioConRol('propietario'))).toBeTrue();
  });

  it('no permite un usuario que solo es perforador', () => {
    const resultado = ejecutarGuard(usuarioConRol('perforador'));
    const router = TestBed.inject(Router);

    expect(resultado instanceof UrlTree).toBeTrue();
    expect(router.serializeUrl(resultado as UrlTree)).toBe(
      '/home?redirectTo=%2Fruta-propietario'
    );
  });
});
