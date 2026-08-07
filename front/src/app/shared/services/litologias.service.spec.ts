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

  it('comparte activas, reintenta tras error y comparte excepciones historicas', async () => {
    const primera = service.listar();
    const segunda = service.listar();
    expect(primera).toBe(segunda);
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([], { status: 500, statusText: 'Error' });
    await expectAsync(primera).toBeRejected();
    const reintento = service.listar();
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([]);
    await expectAsync(reintento).toBeResolvedTo([]);

    const historica1 = service.obtener(7);
    const historica2 = service.obtener(7);
    expect(historica1).toBe(historica2);
    http.expectOne((r) => r.url.endsWith('/litologias/7')).flush({ id_litologia: 7, codigo: 'historica', nombre: 'Historica', familia: 'otro', color: '#666666', patron: 'granite', activo: false, orden: 7 });
    await expectAsync(historica1).toBeResolved();
  });

  it('invalida activas despues de una mutacion', async () => {
    const inicial = service.listar();
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([]);
    await inicial;
    const mutacion = service.desactivar(7);
    http.expectOne((r) => r.url.endsWith('/litologias/7/desactivar')).flush({ id_litologia: 7, codigo: 'x', nombre: 'X', familia: 'otro', color: '#666666', patron: 'granite', activo: false, orden: 7 });
    await mutacion;
    const refresco = service.listar();
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([]);
    expect(await refresco).toEqual([]);
  });
});
