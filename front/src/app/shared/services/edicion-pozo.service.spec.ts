import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth-service/auth.service';
import { dentroDeVentana, EdicionPozoService } from './edicion-pozo.service';

describe('Edición de perforaciones: reloj explícito', () => {
  const ahora = Date.parse('2026-10-02T12:00:00Z');
  const pozo = { creado_por: 7, fecha_creado: '2026-10-01T12:00:00.001Z' };
  it('permite al creador hasta el último milisegundo', () => expect(dentroDeVentana(pozo, 7, ahora)).toBeTrue());
  it('rechaza exactamente a las 24 horas y después', () => {
    expect(dentroDeVentana(pozo, 7, ahora + 1)).toBeFalse();
    expect(dentroDeVentana(pozo, 7, ahora + 2)).toBeFalse();
  });
  it('rechaza pozo ajeno, sin creador, fecha inválida o futura', () => {
    expect(dentroDeVentana(pozo, 8, ahora)).toBeFalse();
    expect(dentroDeVentana({ fecha_creado: pozo.fecha_creado }, 7, ahora)).toBeFalse();
    expect(dentroDeVentana({ ...pozo, fecha_creado: 'inválida' }, 7, ahora)).toBeFalse();
    expect(dentroDeVentana(pozo, 7, ahora - 86_400_000)).toBeFalse();
  });
});

describe('EdicionPozoService: roles y pantalla abierta', () => {
  let roles: string[];
  beforeEach(() => {
    roles = ['perforador'];
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: {
      puedeOperarTodosLosPozos: () => roles.includes('administracion') || roles.includes('operador_administrativo'),
      tieneRol: (rol: string) => roles.includes(rol), userId: () => 7,
    } }] });
  });
  it('revalida el reloj al guardar aunque el registro no haya cambiado', () => {
    const reloj = spyOn(Date, 'now').and.returnValue(Date.parse('2026-10-02T11:59:59Z'));
    const service = TestBed.inject(EdicionPozoService);
    const pozo = { creado_por: 7, fecha_creado: '2026-10-01T12:00:00Z' };
    expect(service.puedeEditar(pozo)).toBeTrue();
    reloj.and.returnValue(Date.parse('2026-10-02T12:00:00Z'));
    expect(service.puedeEditar(pozo)).toBeFalse();
  });
  it('da prioridad a administración y conserva propietario sin edición', () => {
    const service = TestBed.inject(EdicionPozoService);
    const viejo = { creado_por: 8, fecha_creado: '2000-01-01T00:00:00Z' };
    roles = ['administracion', 'perforador'];
    expect(service.puedeEditar(viejo)).toBeTrue();
    roles = ['operador_administrativo'];
    expect(service.puedeEditar({...viejo, origen:'historico'})).toBeTrue();
    roles = ['propietario'];
    expect(service.puedeEditar(viejo)).toBeFalse();
  });
});
