import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FotoPozoService } from './fotoPozo.service';

describe('FotoPozoService', () => {
  it('elimina una foto persistida mediante DELETE', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(FotoPozoService);
    const http = TestBed.inject(HttpTestingController);
    const promesa = service.eliminarFoto(4, 8);
    const req = http.expectOne((request) => request.method === 'DELETE' && request.url.endsWith('/usuarios/4/pozos/8/foto'));
    req.flush(null);
    await expectAsync(promesa).toBeResolved();
  });
});
