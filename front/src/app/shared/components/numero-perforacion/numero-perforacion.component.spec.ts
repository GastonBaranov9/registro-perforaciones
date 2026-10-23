import { TestBed } from '@angular/core/testing';
import { NumeroPerforacionComponent } from './numero-perforacion.component';
import { NumeracionPerforacionService } from '../../services/numeracion-perforacion.service';

describe('NumeroPerforacionComponent', () => {
  const servicio = { consultar: jasmine.createSpy('consultar') };
  beforeEach(() => {
    servicio.consultar.calls.reset();
    TestBed.configureTestingModule({ imports: [NumeroPerforacionComponent], providers: [{ provide: NumeracionPerforacionService, useValue: servicio }] });
  });
  it('campo vacío solicita automático y no consulta disponibilidad', async () => {
    const f = TestBed.createComponent(NumeroPerforacionComponent);
    const emitted = spyOn(f.componentInstance.numeroChange, 'emit');
    f.componentInstance.cambiar(null);
    await f.componentInstance.consultar();
    expect(emitted).toHaveBeenCalledWith(null);
    expect(servicio.consultar).not.toHaveBeenCalled();
  });
  it('informa un duplicado sin guardar ni crear registros', async () => {
    servicio.consultar.and.resolveTo({ utilizado: true });
    const f = TestBed.createComponent(NumeroPerforacionComponent);
    f.componentRef.setInput('numero', 1850);
    await f.componentInstance.consultar(); f.detectChanges();
    expect(f.nativeElement.textContent).toContain('ya está utilizado o reservado');
    expect(servicio.consultar).toHaveBeenCalledOnceWith(1850);
  });
  it('ignora una respuesta de disponibilidad anterior a la edición del campo', async () => {
    let resolve!: (value: { utilizado: boolean }) => void;
    servicio.consultar.and.returnValue(new Promise(r => resolve = r));
    const f = TestBed.createComponent(NumeroPerforacionComponent);
    f.componentRef.setInput('numero', 1850);
    const pending = f.componentInstance.consultar();
    f.componentInstance.cambiar(1990); f.componentRef.setInput('numero', 1990);
    resolve({ utilizado: true }); await pending;
    expect(f.componentInstance.mensaje()).toBe('');
  });
});
