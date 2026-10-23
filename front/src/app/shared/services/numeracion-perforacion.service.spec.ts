import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NumeracionPerforacionService, numeroPerforacionValido } from './numeracion-perforacion.service';
import { environment } from '../../../environments/environment';

describe('NumeracionPerforacionService', () => {
  let service: NumeracionPerforacionService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(NumeracionPerforacionService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('configura el contador con el valor anterior para detectar cambios concurrentes', async () => {
    const pending = service.configurar(2047, null);
    const req = http.expectOne(environment.apiURL + 'pozos/numeracion');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ proximo: 2047, esperado: null });
    req.flush({ proximo: 2047, minimo: 2047, agotado: false });
    expect((await pending).proximo).toBe(2047);
  });
  it('propaga el conflicto legible al intentar asignar un número reservado', async () => {
    const pending = service.asignarPendiente(12, 1850);
    const rejected = expectAsync(pending).toBeRejectedWithError('Ese número ya está utilizado.');
    const req = http.expectOne(environment.apiURL + 'pozos/12/numero-perforacion');
    expect(req.request.body).toEqual({ numero_perforacion: 1850 });
    req.flush({ message: 'Ese número ya está utilizado.' }, { status: 409, statusText: 'Conflict' });
    await rejected;
  });
  it('valida rango y tipo sin transformar valores inválidos en asignación automática', () => {
    for (const invalid of [0, -1, 1.5, NaN, Infinity, 2147483648, '2047', true, null]) expect(numeroPerforacionValido(invalid)).toBeFalse();
    for (const valid of [1, 2047, 2147483647]) expect(numeroPerforacionValido(valid)).toBeTrue();
  });
});
