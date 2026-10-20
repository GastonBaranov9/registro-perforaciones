import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { PozosEditService } from './pozos-edit.service';
import { AuthService } from './auth-service/auth.service';
import { tecnicosPersistidos } from '../utils/tecnicos-persistidos';

describe('PozosEditService', () => {
  let service: PozosEditService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(PozosEditService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
  for (const nuevo of [undefined, null, { desde_m: 3.125, hasta_m: 8.875 }]) {
    it('edición del sello omite si no cambió, null elimina y objeto actualiza: ' + JSON.stringify(nuevo), async () => {
      spyOn(TestBed.inject(AuthService), 'userId').and.returnValue(9);
      const originales = tecnicosPersistidos([], [], [], [], { desde_m: 1.125, hasta_m: 9.875 });
      const actual = structuredClone(originales);
      if (nuevo !== undefined) actual.sello_sanitario_constructivo = nuevo;
      const guardar = service.editPozoCompleto(5, { id_propietario: 2, id_perforador: 9, id_sitio: 3 }, actual, null, 'conservar', originales);
      const http = TestBed.inject(HttpTestingController);
      const req = http.expectOne(request => request.method === 'PUT');
      const cuerpo = JSON.parse(JSON.stringify(req.request.body));
      expect(cuerpo.sello_sanitario_constructivo).toEqual(nuevo);
      if (nuevo === undefined) expect(Object.hasOwn(cuerpo, 'sello_sanitario_constructivo')).toBeFalse();
      req.flush({ pozo: { id_pozo: 5 } }); await guardar; http.verify();
    });
  }

  it('envía la edición completa sin IDs locales y con acción de foto', async () => {
    spyOn(TestBed.inject(AuthService), 'userId').and.returnValue(9);
    const pozoHistoricoHidratado = {
      id_propietario: 2, id_perforador: 9, id_sitio: 3,
      numero_perforacion: 2047, sello_sanitario: true, pre_filtro: 'Prefiltro histórico',
    } as Parameters<PozosEditService['editPozoCompleto']>[1] & {
      sello_sanitario: boolean; pre_filtro: string;
    };
    const promesa = service.editPozoCompleto(5, pozoHistoricoHidratado, {
      intervalosLitologicos: [{ idLocal: 'local-1', dato: { desde_m: 0, hasta_m: 2, material: 'Arena' } }],
      intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [],
    }, null, 'eliminar');
    const http = TestBed.inject(HttpTestingController);
    const req = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/usuarios/9/pozos/5/completo'));
    expect(req.request.body.intervalos_litologicos).toEqual([{ desde_m: 0, hasta_m: 2, material: 'Arena' }]);
    expect(req.request.body.foto_accion).toBe('eliminar');
    expect(req.request.body.pozo.sello_sanitario).toBeUndefined();
    expect(req.request.body.pozo.pre_filtro).toBeUndefined();
    expect(req.request.body.pozo.numero_perforacion).toBeUndefined();
    req.flush({ pozo: { id_pozo: 5 }, intervalos_litologicos: [], intervalos_diametro: [], niveles_aporte: [] });
    await promesa; http.verify();
  });
});
