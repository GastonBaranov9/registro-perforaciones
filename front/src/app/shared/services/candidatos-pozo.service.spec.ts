import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CandidatosPozoService } from './candidatos-pozo.service';

describe('CandidatosPozoService', () => {
  it('obtiene exclusivamente el contrato limitado de candidatos', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(CandidatosPozoService); const http = TestBed.inject(HttpTestingController);
    const promesa = service.obtener(); const req = http.expectOne((r) => r.url.endsWith('/pozos/candidatos-personas'));
    expect(req.request.method).toBe('GET');
    req.flush({ propietarios: [], perforadores: [] });
    await expectAsync(promesa).toBeResolvedTo({ propietarios: [], perforadores: [] }); http.verify();
  });
});
