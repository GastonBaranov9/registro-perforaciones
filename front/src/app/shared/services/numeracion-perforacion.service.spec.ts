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
  it('rectifica sólo con motivo, declaración y estado completo de la vista previa', async () => {
    const reserva={numero_perforacion:4001,id_pozo_original:'99',asignado_en:'2026-01-01 12:00:00+00',bloqueada:false};
    const pending=service.rectificar(4001,{token:"signed",proximo:4002,mayor_asignado:4001,reservas:[reserva]},'Prueba eliminada',true);
    const req=http.expectOne(environment.apiURL+'pozos/numeracion/rectificacion');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({token:"signed",confirmacion:"RECTIFICAR",pruebas_confirmadas:true,desde:4001,esperado:4002,mayor_esperado:4001,motivo:'Prueba eliminada',sin_referencias_externas:true,
      reservas:[{numero_perforacion:4001,id_pozo_original:'99',asignado_en:reserva.asignado_en}]});
    req.flush({proximo:4001,minimo:4001,agotado:false,rectificacion_id:'7'});
    expect((await pending).rectificacion_id).toBe('7');
  });
  it('configura el contador con el valor anterior para detectar cambios concurrentes', async () => {
    const pending = service.configurar(4000, null,"Adelanto administrativo");
    const req = http.expectOne(environment.apiURL + 'pozos/numeracion');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ proximo: 4000, esperado: null, motivo:"Adelanto administrativo" });
    req.flush({ proximo: 4000, minimo: 4000, agotado: false });
    expect((await pending).proximo).toBe(4000);
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
    for (const invalid of [0, -1, 1.5, NaN, Infinity, 2147483648, '4000', true, null]) expect(numeroPerforacionValido(invalid)).toBeFalse();
    for (const valid of [1, 4000, 2147483647]) expect(numeroPerforacionValido(valid)).toBeTrue();
  });
});
