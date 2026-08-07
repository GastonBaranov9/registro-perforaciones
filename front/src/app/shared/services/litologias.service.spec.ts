import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { LitologiasService } from './litologias.service';

describe('LitologiasService', () => {
  let service: LitologiasService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [LitologiasService, provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(LitologiasService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('lista activas y solicita inactivas solo para administración', async () => {
    const activas = service.listar();
    http.expectOne((r) => r.url.endsWith('/litologias') && !r.params.has('incluir_inactivas')).flush([]);
    await expectAsync(activas).toBeResolved();
    const todas = service.listar(true);
    http.expectOne((r) => r.url.endsWith('/litologias') && r.params.get('incluir_inactivas') === 'true').flush([]);
    await expectAsync(todas).toBeResolved();
  });
});
