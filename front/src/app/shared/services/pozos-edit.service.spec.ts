import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { PozosEditService } from './pozos-edit.service';
import { AuthService } from './auth-service/auth.service';

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

  it('envía la edición completa sin IDs locales y con acción de foto', async () => {
    spyOn(TestBed.inject(AuthService), 'userId').and.returnValue(9);
    const promesa = service.editPozoCompleto(5, { id_propietario: 2, id_perforador: 9, id_sitio: 3 }, {
      intervalosLitologicos: [{ idLocal: 'local-1', dato: { desde_m: 0, hasta_m: 2, material: 'Arena' } }],
      intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [],
    }, null, 'eliminar');
    const http = TestBed.inject(HttpTestingController);
    const req = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/usuarios/9/pozos/5/completo'));
    expect(req.request.body.intervalos_litologicos).toEqual([{ desde_m: 0, hasta_m: 2, material: 'Arena' }]);
    expect(req.request.body.foto_accion).toBe('eliminar');
    req.flush({ pozo: { id_pozo: 5 }, intervalos_litologicos: [], intervalos_diametro: [], niveles_aporte: [] });
    await promesa; http.verify();
  });
});
