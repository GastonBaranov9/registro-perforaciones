import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RectificacionNumeracionComponent } from './rectificacion-numeracion.component';
import { NumeracionPerforacionService, VistaRectificacion } from '../../../../shared/services/numeracion-perforacion.service';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';

describe('Rectificación administrativa de numeración', () => {
  let page: RectificacionNumeracionComponent;
  let fixture: ComponentFixture<RectificacionNumeracionComponent>;
  let servicio: jasmine.SpyObj<NumeracionPerforacionService>;
  let auth: { tieneRol: jasmine.Spy };
  const vista: VistaRectificacion = { token:"signed",proximo:4002, mayor_asignado:4001,
    reservas:[{numero_perforacion:4001,id_pozo_original:'99',asignado_en:'2026-01-01 12:00:00+00',bloqueada:false}] };
  beforeEach(async () => {
    servicio=jasmine.createSpyObj('Numeracion',['previsualizar','rectificar']);
    servicio.previsualizar.and.resolveTo(vista);
    servicio.rectificar.and.resolveTo({proximo:4001,minimo:4001,agotado:false,rectificacion_id:'1'});
    auth={tieneRol:jasmine.createSpy().and.callFake(rol => rol==='administracion')};
    await TestBed.configureTestingModule({imports:[RectificacionNumeracionComponent],providers:[
      {provide:NumeracionPerforacionService,useValue:servicio},{provide:AuthService,useValue:auth},
    ]}).compileComponents();
    fixture=TestBed.createComponent(RectificacionNumeracionComponent); page=fixture.componentInstance;
    page.desde=4001; fixture.detectChanges();
  });
  async function preparar() { await page.previsualizar(); page.motivo='Pruebas ficticias eliminadas'; page.sinReferencias=true; page.confirmacion='RECTIFICAR'; }
  it('vista previa identifica reservas y no escribe; Cancelar invalida la confirmación',async () => {
    await preparar(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('ID original: 99');
    expect(fixture.nativeElement.textContent).toContain('4002 → 4001');
    expect(servicio.rectificar).not.toHaveBeenCalled();
    page.cancelar(); await page.rectificar();
    expect(servicio.rectificar).not.toHaveBeenCalled(); expect(page.vista()).toBeNull();
  });
  it('exige motivo, declaración y palabra exacta',async () => {
    await page.previsualizar();
    for (const [motivo,sinReferencias,confirmacion] of [['',true,'RECTIFICAR'],['Motivo suficiente',false,'RECTIFICAR'],['Motivo suficiente',true,'rectificar']] as const) {
      page.motivo=motivo; page.sinReferencias=sinReferencias; page.confirmacion=confirmacion;
      await page.rectificar();
    }
    expect(servicio.rectificar).not.toHaveBeenCalled();
  });
  it('reservas bloqueadas o rango cambiado invalidan la confirmación',async () => {
    await preparar(); page.vista.set({...vista,reservas:vista.reservas.map(r => ({...r,bloqueada:true}))});
    await page.rectificar(); expect(servicio.rectificar).not.toHaveBeenCalled();
    page.cambiarDesde(4000); expect(page.vista()).toBeNull(); expect(page.confirmacion).toBe('');
  });
  for(const rol of ['perforador','operador_administrativo','']) {
    it(`restringe vista y ejecución para ${rol || 'sin rol'}`,async () => {
      await preparar(); auth.tieneRol.and.callFake(nombre => nombre===rol); fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('section')).toBeNull();
      await page.rectificar(); expect(servicio.rectificar).not.toHaveBeenCalled();
    });
  }
  it('confirmación válida envía una petición; informa auditoría y actualiza contador',async () => {
    await preparar(); const emit=spyOn(page.rectificada,'emit');
    let terminar!: (value:any) => void;
    servicio.rectificar.and.returnValue(new Promise(resolve => terminar=resolve));
    const pending=page.rectificar(); await page.rectificar();
    expect(servicio.rectificar).toHaveBeenCalledOnceWith(4001,vista,'Pruebas ficticias eliminadas',true);
    terminar({proximo:4001,rectificacion_id:'27'}); await pending;
    expect(page.mensaje()).toContain('27'); expect(emit).toHaveBeenCalledTimes(1);
    expect(page.vista()).toBeNull(); expect(page.ocupado()).toBeFalse();
  });
  it('conflicto exige nueva vista previa y nunca reintenta automáticamente',async () => {
    await preparar(); servicio.rectificar.and.rejectWith(new Error('La numeración cambió'));
    await page.rectificar(); await page.rectificar();
    expect(servicio.rectificar).toHaveBeenCalledTimes(1);
    expect(page.mensaje()).toBe('La numeración cambió'); expect(page.vista()).toBeNull();
  });
});
