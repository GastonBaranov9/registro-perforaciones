import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { ExportarKmlService } from './exportar-kml.service';

describe('ExportarKmlService', () => {
  let servicio: ExportarKmlService;
  let http: HttpTestingController;
  let click: jasmine.Spy;
  const archivo = () => new Blob(['<?xml version="1.0"?><kml/>'], { type: 'application/vnd.google-earth.kml+xml' });
  const url = `${environment.apiURL}pozos/exportar/kml`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    servicio = TestBed.inject(ExportarKmlService);
    http = TestBed.inject(HttpTestingController);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:kml-prueba');
    spyOn(URL, 'revokeObjectURL');
    click = spyOn(HTMLAnchorElement.prototype, 'click');
  });
  afterEach(() => http.verify());

  it('descarga un Blob con filename fijo, sin abrir texto, y devuelve los contadores', fakeAsync(() => {
    let enlace: HTMLAnchorElement | undefined;
    click.and.callFake(function(this: HTMLAnchorElement) { enlace = this; });
    const abrir = spyOn(window, 'open');
    let resultado: unknown;
    servicio.descargar().then(valor => resultado = valor);
    const req = http.expectOne(url);
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    const blob = archivo();
    req.flush(blob, { headers: { 'X-KML-Exportadas': '12', 'X-KML-Omitidas': '3', 'Content-Disposition': 'attachment; filename="perforaciones-raulsilva.kml"' } });
    flushMicrotasks();
    expect(URL.createObjectURL).toHaveBeenCalledOnceWith(blob);
    expect(enlace!.download).toBe('perforaciones-raulsilva.kml');
    expect(enlace!.href).toBe('blob:kml-prueba');
    expect(enlace!.isConnected).toBeFalse();
    expect(abrir).not.toHaveBeenCalled();
    expect(resultado).toEqual({ exportadas: 12, omitidas: 3 });
    tick();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:kml-prueba');
  }));

  const headersInvalidos: Record<string, string>[] = [{}, { 'X-KML-Exportadas': '-1', 'X-KML-Omitidas': 'abc' }, { 'X-KML-Exportadas': '', 'X-KML-Omitidas': '9007199254740992' }];
  for (const headers of headersInvalidos) {
    it(`descarga sin inventar contadores ausentes o inválidos: ${JSON.stringify(headers)}`, async () => {
      const promesa = servicio.descargar();
      http.expectOne(url).flush(archivo(), { headers });
      expect(await promesa).toEqual({ exportadas: null, omitidas: null });
      expect(click).toHaveBeenCalledTimes(1);
    });
  }

  it('conserva contadores cero', async () => {
    const promesa = servicio.descargar();
    http.expectOne(url).flush(archivo(), { headers: { 'X-KML-Exportadas': '0', 'X-KML-Omitidas': '0' } });
    expect(await promesa).toEqual({ exportadas: 0, omitidas: 0 });
  });

  it('un 403 no produce ningún archivo', async () => {
    const promesa = servicio.descargar();
    http.expectOne(url).flush(new Blob(['Forbidden']), { status: 403, statusText: 'Forbidden' });
    await expectAsync(promesa).toBeRejected();
    expect(click).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('rechaza respuesta vacía o HTML sin guardarla como KML', async () => {
    for (const blob of [new Blob([], { type: 'application/vnd.google-earth.kml+xml' }), new Blob(['error'], { type: 'text/html' })]) {
      const promesa = servicio.descargar();
      http.expectOne(url).flush(blob);
      await expectAsync(promesa).toBeRejectedWithError('No se recibió un archivo KML válido.');
    }
    expect(click).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
