import { TestBed } from '@angular/core/testing';
import { VincularPropietarioComponent } from './vincular-propietario.component';
import { PropietariosOperativosService } from '../../../../shared/services/propietarios-operativos.service';
import { CandidatosPozoService } from '../../../../shared/services/candidatos-pozo.service';

describe('VincularPropietarioComponent', () => {
  const persona={id_usuario:7,nombre:'Identidad verificada',roles:['propietario']};
  let service: { crear: jasmine.Spy; vincular: jasmine.Spy };
  beforeEach(() => {
    service={crear:jasmine.createSpy().and.resolveTo(persona),vincular:jasmine.createSpy().and.resolveTo()};
    TestBed.configureTestingModule({imports:[VincularPropietarioComponent],providers:[
      {provide:PropietariosOperativosService,useValue:service},
      {provide:CandidatosPozoService,useValue:{buscar:jasmine.createSpy().and.resolveTo([persona])}},
    ]});
  });
  function crear() {
    const fixture=TestBed.createComponent(VincularPropietarioComponent);
    fixture.componentRef.setInput('idPozo',44);
    fixture.componentRef.setInput('propietarioActual',null);
    fixture.detectChanges();return fixture;
  }
  it('vincula solo la identidad, bloquea doble envío y emite después de guardar',async()=>{
    const fixture=crear(), component=fixture.componentInstance;
    component.persona.set(persona);
    let resolve!:()=>void;service.vincular.and.returnValue(new Promise<void>(r=>resolve=r));
    const emitir=spyOn(component.vinculado,'emit');
    const pendiente=component.vincular();await component.vincular();
    expect(service.vincular).toHaveBeenCalledOnceWith(44,7,null);
    expect(emitir).not.toHaveBeenCalled();resolve();await pendiente;
    expect(emitir).toHaveBeenCalledOnceWith(persona);expect(component.ocupado()).toBeFalse();
  });
  it('conserva selección al fallar y permite reintentar sin crear otra cuenta',async()=>{
    const component=crear().componentInstance;component.nombre='Identidad verificada';
    await component.crear();expect(service.crear).toHaveBeenCalledTimes(1);
    service.vincular.and.rejectWith(new Error('Conflicto'));
    const emitir=spyOn(component.vinculado,'emit');await component.vincular();
    expect(emitir).not.toHaveBeenCalled();expect(component.persona()).toEqual(persona);
    service.vincular.and.resolveTo();await component.vincular();
    expect(service.crear).toHaveBeenCalledTimes(1);expect(emitir).toHaveBeenCalledOnceWith(persona);
  });
});
