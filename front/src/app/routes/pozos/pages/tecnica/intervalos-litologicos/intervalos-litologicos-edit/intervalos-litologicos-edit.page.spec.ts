import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosLitologicosEditPage } from './intervalos-litologicos-edit.page';
import { IntervaloLitologicoEditService } from '../../../../../../shared/services/intervalo-lit-service/intervalo-lit-edit/intervalo-litologico-edit.service';
import { LitologiasService } from '../../../../../../shared/services/litologias.service';
import { IntervaloLitFormComponent } from '../components/intervalo-lit-form/intervalo-lit-form.component';

describe('IntervalosLitologicosEditPage', () => {
  let component: IntervalosLitologicosEditPage;
  let fixture: ComponentFixture<IntervalosLitologicosEditPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        {provide:IntervaloLitologicoEditService,useValue:{getIntLito:async()=>({desde_m:0,hasta_m:2,material:'Tosca',id_litologia:null,litologia_provisional:'Tosca'})}},
        {provide:LitologiasService,useValue:{listar:async()=>[]}}],
      imports: [IntervalosLitologicosEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosLitologicosEditPage);
    fixture.componentRef.setInput('id_pozo', 1);
    fixture.componentRef.setInput('id_intervalo_litologico', 1);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('carga limpia, detecta edición y limpia dirty al revertir desde el formulario real',async()=>{
    await fixture.whenStable();fixture.detectChanges();
    expect(component.tieneCambiosSinGuardar()).toBeFalse();
    const form=TestBed.createComponent(IntervaloLitFormComponent);
    form.componentRef.setInput('intervaloLitologico',component.intervaloResource.value());
    form.componentInstance.provisional('Tosca roja');
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
    form.componentInstance.provisional('Tosca');
    expect(component.tieneCambiosSinGuardar()).toBeFalse();
    form.componentInstance.provisional(null);form.componentInstance.seleccionar(1,'Basalto');
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
  });
});
