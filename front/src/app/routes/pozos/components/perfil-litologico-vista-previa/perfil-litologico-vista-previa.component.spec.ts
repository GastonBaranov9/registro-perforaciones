import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { PerfilLitologicoService } from '../../../../shared/services/perfil-litologico.service';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { PerfilLitologico } from '../../../../shared/types/schemas';
import { PerfilLitologicoVistaPreviaComponent } from './perfil-litologico-vista-previa.component';
import { PerfilLitologicoComponent } from '../../../../shared/components/perfil-litologico/perfil-litologico.component';
import { By } from '@angular/platform-browser';

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
  it('transporta agregar, modificar y quitar sello sin conflictos con la litología', fakeAsync(() => {
    const fixture = TestBed.createComponent(PerfilLitologicoVistaPreviaComponent);
    fixture.componentRef.setInput('idPozo',4); fixture.componentRef.setInput('profundidad',20);
    const datos = {...vacio,intervalosLitologicos:[{idLocal:'basalto',dato:{desde_m:0,hasta_m:20,material:'Basalto',id_litologia:1}}]};
    fixture.componentRef.setInput('datos',datos); fixture.detectChanges(); tick(300);
    expect(servicio.vistaPrevia.calls.mostRecent().args[2].sello_sanitario_constructivo).toBeNull();
    for (const sello of [{desde_m:0,hasta_m:10},{desde_m:2.5,hasta_m:8.75},null]) {
      fixture.componentRef.setInput('datos',{...datos,sello_sanitario_constructivo:sello}); fixture.detectChanges(); tick(300);
      const body=servicio.vistaPrevia.calls.mostRecent().args[2];
      expect(body.sello_sanitario_constructivo).toEqual(sello);
      expect(body.intervalos_litologicos).toEqual([{desde_m:0,hasta_m:20,material:'Basalto',id_litologia:1}]);
      expect(fixture.componentInstance.error()).toBe('');
    }
    expect(servicio.vistaPrevia).toHaveBeenCalledTimes(4);
  }));
  it('renderiza la respuesta canónica y retira las bandas al quitar el sello', fakeAsync(() => {
    const fixture=TestBed.createComponent(PerfilLitologicoVistaPreviaComponent);
    fixture.componentRef.setInput('idPozo',4); fixture.componentRef.setInput('profundidad',20);
    const sello={desde_m:0,hasta_m:10};
    fixture.componentRef.setInput('datos',{...vacio,sello_sanitario_constructivo:sello}); fixture.detectChanges(); tick(300);
    const modelo: PerfilLitologico={
      titulo:'Perfil litológico del pozo',profundidad_m:20,paso_escala_m:2,
      tramos:[{clase:'litologia',desde_m:0,hasta_m:20,material:'Basalto',descripcion:null,estilo:{color:'#777777',gris:.5,patron:'basalt'},carril_etiqueta:0}],
      tuberias:[],filtros:[],aportes:[],etiquetas:[],advertencias:[],tiene_litologia:true,rangos:[{desde_m:0,hasta_m:20}],
      seccion_pozo:{tuberia_exterior_inicio:.36,tuberia_exterior_fin:.64,tuberia_interior_inicio:.43,tuberia_interior_fin:.57},
      geometria:{ancho_logico:760,alto_logico:820,columna:{x:90,y:70,ancho:180,alto:700},x_texto_escala:12,carriles_etiqueta_x:[310,390,470,550],separacion_vertical_normalizada:.055,conector:{salida:12,llegada:8},alto_texto:16},
      sello_sanitario_constructivo:{...sello,texto:'Sello sanitario 0-10 m',estilo:{color:'#999999',gris:.6,patron:'concrete'},geometria:{bandas:[{x_inicio:.29,x_fin:.35},{x_inicio:.65,x_fin:.71}]}},
    };
    respuestas[0].next(modelo); fixture.detectChanges(); tick(); fixture.detectChanges();
    expect(fixture.debugElement.query(By.directive(PerfilLitologicoComponent))).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.sello-sanitario').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.capa').getAttribute('height')).toBe('700');
    expect(fixture.nativeElement.querySelector('.sello-sanitario').getAttribute('height')).toBe('350');
    fixture.componentRef.setInput('datos',{...vacio,sello_sanitario_constructivo:null}); fixture.detectChanges(); tick(300);
    respuestas[1].next({...modelo,sello_sanitario_constructivo:null}); fixture.detectChanges(); tick(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sello-sanitario')).toBeNull();
    expect(fixture.nativeElement.querySelector('.leyenda-constructiva')).toBeNull();
  }));
});
