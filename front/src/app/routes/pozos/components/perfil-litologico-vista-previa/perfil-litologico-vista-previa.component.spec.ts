import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PerfilLitologicoService } from '../../../../shared/services/perfil-litologico.service';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { PerfilLitologico } from '../../../../shared/types/schemas';
import { PerfilLitologicoVistaPreviaComponent } from './perfil-litologico-vista-previa.component';

describe('PerfilLitologicoVistaPreviaComponent', () => {
  const respuestas: Subject<PerfilLitologico>[] = [];
  const servicio = { vistaPrevia: jasmine.createSpy().and.callFake(() => { const respuesta = new Subject<PerfilLitologico>(); respuestas.push(respuesta); return respuesta; }) };
  const vacio = { intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] };
  beforeEach(async () => {
    respuestas.length = 0; servicio.vistaPrevia.calls.reset();
    await TestBed.configureTestingModule({ imports: [PerfilLitologicoVistaPreviaComponent], providers: [{ provide: PerfilLitologicoService, useValue: servicio }, { provide: AuthService, useValue: { userId: () => 7 } }] }).compileComponents();
  });
  it('aplica debounce y cancela la respuesta anterior al cambiar el borrador', fakeAsync(() => {
    const fixture = TestBed.createComponent(PerfilLitologicoVistaPreviaComponent);
    fixture.componentRef.setInput('idPozo', 4); fixture.componentRef.setInput('profundidad', 20); fixture.componentRef.setInput('datos', vacio); fixture.detectChanges(); tick(300);
    expect(servicio.vistaPrevia).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('datos', { ...vacio, nivelesAporte: [{ idLocal: 'a', dato: { profundidad_m: 5 } }] }); fixture.detectChanges(); tick(300);
    expect(servicio.vistaPrevia).toHaveBeenCalledTimes(2); expect(respuestas[0].observed).toBeFalse();
  }));
  it('no consulta datos inválidos ni pierde el borrador', fakeAsync(() => {
    const fixture = TestBed.createComponent(PerfilLitologicoVistaPreviaComponent);
    fixture.componentRef.setInput('idPozo', 4); fixture.componentRef.setInput('profundidad', 10); fixture.componentRef.setInput('datos', { ...vacio, intervalosLitologicos: [{ idLocal: 'x', dato: { desde_m: 0, hasta_m: 12, material: 'Arena' } }] }); fixture.detectChanges(); tick(300);
    expect(servicio.vistaPrevia).not.toHaveBeenCalled(); expect(fixture.componentInstance.error()).toContain('excede'); expect(fixture.componentInstance.datos().intervalosLitologicos.length).toBe(1);
  }));
});
