import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { PozosCreateService } from './pozos-create.service';
import { HttpTestingController } from '@angular/common/http/testing';

describe('PozosCreateService', () => {
  let service: PozosCreateService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(PozosCreateService);
    http = TestBed.inject(HttpTestingController);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('envía el contrato compuesto sin IDs locales', async () => {
    const promesa = service.createPozoCompleto(
      1,
      { id_propietario: 1, id_sitio: 2, id_perforador: 3, profundidad_final_m: 20 },
      { intervalosLitologicos: [{ idLocal: 'local-9', dato: { desde_m: 0, hasta_m: 10, material: 'Arena' } }], intervalosDiametro: [], nivelesAporte: [] },
      null,
    );
    const req = http.expectOne((request) => request.url.endsWith('/usuarios/1/pozos/completo'));
    expect(req.request.body.intervalos_litologicos).toEqual([{ desde_m: 0, hasta_m: 10, material: 'Arena' }]);
    expect(JSON.stringify(req.request.body)).not.toContain('local-9');
    req.flush({ pozo: { id_pozo: 9 }, intervalos_litologicos: [], intervalos_diametro: [], niveles_aporte: [] });
    expect((await promesa).pozo.id_pozo).toBe(9);
  });
});
