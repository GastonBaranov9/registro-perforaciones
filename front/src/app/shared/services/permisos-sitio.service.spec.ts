import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth-service/auth.service';
import { PermisosSitioService } from './permisos-sitio.service';
import { PozosListService } from './pozos-list.service';

describe('PermisosSitioService: sitios asociados y roles', () => {
  for (const roles of [['administracion'], ['operador_administrativo'],
    ['operador_administrativo', 'perforador', 'propietario'], ['perforador'], ['propietario']]) {
    it(`${roles.join('+')}: respeta asociación y permisos operativos`, async () => {
      let registros = [{ id_sitio: 12, creado_por: 7, fecha_creado: new Date().toISOString() }];
      const listado = jasmine.createSpy('getListaPozos').and.callFake(async () => registros);
      TestBed.configureTestingModule({ providers: [PermisosSitioService,
        { provide: AuthService, useValue: {
          tieneRol: (rol: string) => roles.includes(rol), userId: () => 7,
          puedeOperarTodosLosPozos: () => roles.includes('administracion'),
          puedeGestionarHistoricos: () => roles.includes('administracion') || roles.includes('operador_administrativo'),
        } },
        { provide: PozosListService, useValue: { getListaPozos: listado } },
      ] });
      const servicio = TestBed.inject(PermisosSitioService);
      TestBed.tick(); await new Promise(resolve => setTimeout(resolve, 0)); TestBed.tick();
      expect(servicio.puedeEditar(12)).toBe(!roles.includes('propietario') || roles.includes('operador_administrativo'));
      expect(servicio.puedeEditar(99)).toBe(roles.includes('administracion'));
      if (roles.includes('administracion')) expect(listado).not.toHaveBeenCalled();
      registros = []; servicio.recargar();
      TestBed.tick(); await new Promise(resolve => setTimeout(resolve, 0)); TestBed.tick();
      expect(servicio.puedeEditar(12)).toBe(roles.includes('administracion'));
    });
  }
});
