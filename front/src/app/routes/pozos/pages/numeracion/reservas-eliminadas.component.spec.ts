import { TestBed } from '@angular/core/testing';
import { AdministracionEliminacionesService, VistaEliminacion } from '../../../../shared/services/administracion-eliminaciones.service';
import { ReservasEliminadasComponent } from './reservas-eliminadas.component';
describe('Reservas eliminadas individuales',()=>{
  let page:ReservasEliminadasComponent,api:jasmine.SpyObj<AdministracionEliminacionesService>;
  const v:VistaEliminacion={numero:3277,id_original:19,asignado_en:'2026-01-01',existe:false,reservada:true,proximo:3282,bloqueos:[],elegible:true,token:'token'};
  beforeEach(()=>{
    api=jasmine.createSpyObj('Reservas',['consultar','liberar']);api.consultar.and.resolveTo(v);api.liberar.and.resolveTo({proximo:3282});
    TestBed.configureTestingModule({imports:[ReservasEliminadasComponent],providers:[{provide:AdministracionEliminacionesService,useValue:api}]});
    page=TestBed.createComponent(ReservasEliminadasComponent).componentInstance;page.numero=3277;
  });
  it('buscar/cancelar/cerrar no libera y no acepta cero',async()=>{
    await page.buscar();page.cancelar();await page.liberar();expect(api.liberar).not.toHaveBeenCalled();
    page.numero=0;await page.buscar();expect(api.consultar).toHaveBeenCalledTimes(1);
  });
  it('exige motivo, declaración y texto; doble clic produce una sola solicitud',async()=>{
    await page.buscar();await page.liberar();expect(api.liberar).not.toHaveBeenCalled();
    page.motivo='Prueba ficticia confirmada';page.declaracion=true;page.confirmacion='LIBERAR';
    let done!:(v:{proximo:number})=>void;api.liberar.and.returnValue(new Promise(r=>done=r));
    const pending=page.liberar();await page.liberar();expect(api.liberar).toHaveBeenCalledOnceWith(3277,jasmine.objectContaining({token:'token',sin_referencias_externas:true}));
    done({proximo:3282});await pending;expect(page.mensaje()).toContain('3282');expect(page.vista()).toBeNull();
  });
  it('bloqueos no son recuperables y respuestas tardías no reabren confirmación',async()=>{
    api.consultar.and.resolveTo({...v,elegible:false,token:null,bloqueos:['Referencia histórica']});
    await page.buscar();page.motivo='Prueba ficticia';page.declaracion=true;page.confirmacion='LIBERAR';await page.liberar();expect(api.liberar).not.toHaveBeenCalled();
    let done!:(v:VistaEliminacion)=>void;api.consultar.and.returnValue(new Promise(r=>done=r));
    const pending=page.buscar();page.cancelar();done(v);await pending;expect(page.vista()).toBeNull();
  });
  it('error exige una nueva consulta y no se reintenta solo',async()=>{
    await page.buscar();page.motivo='Prueba ficticia';page.declaracion=true;page.confirmacion='LIBERAR';api.liberar.and.rejectWith({error:{message:'Conflicto'}});
    await page.liberar();expect(page.mensaje()).toBe('Conflicto');expect(page.vista()).toBeNull();expect(api.liberar).toHaveBeenCalledTimes(1);
  });
});
