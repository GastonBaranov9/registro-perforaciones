import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntervalosLitologicosCreatePage } from './intervalos-litologicos-create.page';
import { IntervaloLitologicoListService } from '../../../../../../shared/services/intervalo-lit-service/intervalo-lit-list/intervalo-litologico-list.service';
import { PozosEditService } from '../../../../../../shared/services/pozos-edit.service';

describe('IntervalosLitologicosCreatePage', () => {
  let component: IntervalosLitologicosCreatePage;
  let fixture: ComponentFixture<IntervalosLitologicosCreatePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [IntervalosLitologicosCreatePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(IntervalosLitologicosCreatePage);
    fixture.componentRef.setInput('id_pozo', 1);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('no absorbe cambios del usuario cuando termina la carga inicial', async () => {
    spyOn(TestBed.inject(IntervaloLitologicoListService), 'getIntervalosLitologicos').and.resolveTo([]);
    spyOn(TestBed.inject(PozosEditService), 'getPozoById').and.resolveTo({ profundidad_final_m: 20 } as any);
    const cargando = component.ngOnInit();
    component.intervaloLitologico().litologia_provisional = 'Arena roja';
    await cargando;
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
    expect(component.intervaloLitologico().litologia_provisional).toBe('Arena roja');
  });
});
