import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DatosTecnicosBorradorComponent } from '../../routes/pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component';
import { SelectorLitologiaComponent } from '../components/selector-litologia/selector-litologia.component';
import { LitologiasService } from '../services/litologias.service';
import { cuerpoHistorico, tecnicosVacios } from './historicos-form';
import { validarDatosTecnicos } from './datos-tecnicos-borrador';
import { huellaFormulario } from './estado-formulario-perforacion';
import { tecnicosPersistidos } from './tecnicos-persistidos';

describe('Datos provisionales en formularios',()=>{
  const pozo={id_propietario:null,id_perforador:0,id_sitio:0};
  const sitio={departamento:'',latitud:'',longitud:''};
  it('perforador provisional se conserva con trim y cambia la huella del guard',()=>{
    const inicial=huellaFormulario(pozo,sitio,tecnicosVacios(),true);
    const actualizado={...pozo,perforador_provisional:' Alejandro Vanucci '};
    expect(cuerpoHistorico(actualizado,sitio,tecnicosVacios(),false)['perforador_provisional']).toBe('Alejandro Vanucci');
    expect(huellaFormulario(actualizado,sitio,tecnicosVacios(),true)).not.toBe(inicial);
    expect(cuerpoHistorico({...actualizado,id_perforador:4},sitio,tecnicosVacios(),true)['perforador_provisional']).toBeNull();
  });
  it('selector provisional activa cambios, conserva texto al cerrar y permite volver al catálogo',async()=>{
    TestBed.configureTestingModule({imports:[DatosTecnicosBorradorComponent],providers:[{provide:LitologiasService,useValue:{listar:async()=>[{id_litologia:1,nombre:'Basalto',familia:'basalto',activo:true,color:'#111111'}]}}]});
    const f=TestBed.createComponent(DatosTecnicosBorradorComponent),c=f.componentInstance;
    const datos=tecnicosVacios();datos.intervalosLitologicos=[{idLocal:'1',dato:{desde_m:0,hasta_m:2,material:''}}];
    f.componentRef.setInput('inicial',datos);f.detectChanges();await f.whenStable();f.detectChanges();
    const selector=f.debugElement.query(By.directive(SelectorLitologiaComponent)).componentInstance as SelectorLitologiaComponent;
    selector.usarProvisional();selector.escribirProvisional(' Arena arcillosa roja ');f.detectChanges();
    const item=c.datos().intervalosLitologicos[0].dato;
    expect(item.id_litologia).toBeUndefined();expect(item.litologia_provisional).toBe(' Arena arcillosa roja ');expect(item.material).toBe('Arena arcillosa roja');
    expect(c.dirty()).toBeTrue();expect(validarDatosTecnicos(c.datos())).toEqual([]);
    selector.cerrarLista();selector.buscar('Arena');selector.cerrarLista();expect(item.litologia_provisional).toBe(' Arena arcillosa roja ');
    selector.escribirProvisional(' ');expect(validarDatosTecnicos(c.datos()).length).toBeGreaterThan(0);
    selector.seleccionar('1');f.detectChanges();expect(item.id_litologia).toBe(1);expect(item.litologia_provisional).toBeNull();
  });
  it('edición conserva provisional persistido y rechaza catálogo más provisional',()=>{
    const datos=tecnicosPersistidos([{id_intervalo_litologico:1,id_pozo:1,desde_m:0,hasta_m:2,material:'Tosca gris compacta',id_litologia:null,litologia_provisional:'Tosca gris compacta'}],[],[],[]);
    expect(datos.intervalosLitologicos[0].dato.litologia_provisional).toBe('Tosca gris compacta');
    expect(validarDatosTecnicos(datos)).toEqual([]);
    datos.intervalosLitologicos[0].dato.id_litologia=1;expect(validarDatosTecnicos(datos).length).toBeGreaterThan(0);
  });
});
