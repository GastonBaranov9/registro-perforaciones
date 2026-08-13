import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PropietariosOperativosService } from './propietarios-operativos.service';

describe('PropietariosOperativosService', () => {
  it('solo envía nombre y email al endpoint operativo', async () => {
    TestBed.configureTestingModule({ providers:[provideHttpClient(),provideHttpClientTesting()] });
    const servicio=TestBed.inject(PropietariosOperativosService);const http=TestBed.inject(HttpTestingController);
    const promesa=servicio.crear({nombre:'Persona nueva'});
    const req=http.expectOne((r)=>r.method==='POST'&&r.url.endsWith('/pozos/propietarios'));
    expect(req.request.body).toEqual({nombre:'Persona nueva'});
    expect(req.request.body.roles).toBeUndefined();expect(req.request.body.activo).toBeUndefined();
    req.flush({id_usuario:91,nombre:'Persona nueva',roles:['propietario']});
    expect((await promesa).id_usuario).toBe(91);
  });
});
