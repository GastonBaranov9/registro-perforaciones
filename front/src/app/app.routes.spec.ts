import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, provideRouter, RouterStateSnapshot, UrlTree } from '@angular/router';
import { routes } from './app.routes';
import { MainStore } from './shared/services/mainstore-service/main.store';
import { RuntimePlatformService } from './core/native/runtime-platform.service';
import { AuthService } from './shared/services/auth-service/auth.service';
import { puedeOperarPozosGuard } from './core/guards/islogged-guard-guard';

describe('autorización de rutas de pozos y Sitios', () => {
  for (const plataforma of ['web', 'android']) {
    for (const rol of ['propietario', 'perforador', 'administracion', 'operador_administrativo']) {
      it(`${plataforma}/${rol}: protege URLs directas y conserva consulta de pozos`, async () => {
        TestBed.configureTestingModule({ providers: [provideRouter([]),
          { provide: RuntimePlatformService, useValue: { platform: () => plataforma } },
          { provide: AuthService, useValue: { bootstrap: async () => {}, state: () => 'authenticated' } },
        ] });
        TestBed.inject(MainStore).setUser({ id_usuario: 7, nombre: 'Usuario', roles: [{ id_rol: 1, nombre: rol, descr: rol }] });
        const casos: Array<[string, boolean]> = [
          ...['sitio', 'sitios-list', 'sitio-detail/:id_sitio', 'sitios-edit/:id_sitio', 'sitios-create/:id_usuario']
            .map(path => [path, rol === 'administracion'] as [string, boolean]),
          ['pozos-create', rol !== 'propietario'], ['pozos-list', true], ['pozos-detail/:id_pozo', true],
          ...['pozos-historicos', 'pozos-historicos/:id_pozo/editar']
            .map(path => [path, ['administracion', 'operador_administrativo'].includes(rol)] as [string, boolean]),
          ...['usuario', 'usuarios-create', 'usuarios-list', 'usuarios-edit/:id_usuario', 'litologias-admin', 'pozos-numeracion']
            .map(path => [path, rol === 'administracion'] as [string, boolean]),
        ];
        for (const [path, permitido] of casos) {
          const ruta = routes.find(ruta => ruta.path === path)!;
          expect(ruta).withContext(path).toBeDefined();
          const resultados = await Promise.all(ruta.canActivate!.map(guard => TestBed.runInInjectionContext(() =>
            (guard as CanActivateFn)({} as ActivatedRouteSnapshot, { url: '/' + path } as RouterStateSnapshot))));
          expect(resultados.every(resultado => resultado === true)).withContext(path).toBe(permitido);
          if (!permitido) expect(resultados.some(resultado => resultado instanceof UrlTree)).toBeTrue();
        }
        expect(routes.find(ruta => ruta.path === 'pozos-create')!.canActivate).toContain(puedeOperarPozosGuard);
      });
    }
  }
});
