import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { SelectorLitologiaComponent } from './selector-litologia.component';
import { LitologiasService } from '../../services/litologias.service';

@Component({ standalone: true, imports: [SelectorLitologiaComponent], template: '<app-selector-litologia />' })
class HostComponent {}

@Component({ standalone: true, imports: [SelectorLitologiaComponent], template: '@for (item of items; track item) { <app-selector-litologia /> }' })
class ManyHostComponent { items = Array.from({ length: 10 }, (_, index) => index); }

@Component({ standalone: true, imports: [SelectorLitologiaComponent], template: '<app-selector-litologia [seleccionado]="7" /><app-selector-litologia [seleccionado]="7" />' })
class HistoricalHostComponent {}

describe('SelectorLitologiaComponent', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [LitologiasService, provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('filtra la búsqueda Are y solo ofrece activas', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([
      { id_litologia: 1, codigo: 'arenisca_rosada', nombre: 'Arenisca rosada', familia: 'arenisca', color: '#C98C82', patron: 'sandstone_fine', activo: true, orden: 1 },
      { id_litologia: 2, codigo: 'basalto', nombre: 'Basalto', familia: 'basalto', color: '#555555', patron: 'basalt', activo: true, orden: 2 },
    ]);
    await fixture.whenStable();
    const selector = fixture.debugElement.query(By.directive(SelectorLitologiaComponent)).componentInstance as SelectorLitologiaComponent;
    selector.busqueda.set('Are');
    expect(selector.opcionesFiltradas().map((x) => x.id_litologia)).toEqual([1]);
    expect(selector.opcionesFiltradas().every((x) => x.activo)).toBeTrue();
  });
  it('permite seleccionar Sello sanitario como litología activa del catálogo', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([
      { id_litologia: 30, codigo: 'sello_sanitario', nombre: 'Sello sanitario', familia: 'otro', color: '#777777', patron: 'granite', activo: true, orden: 30 },
    ]);
    await fixture.whenStable();
    const selector = fixture.debugElement.query(By.directive(SelectorLitologiaComponent)).componentInstance as SelectorLitologiaComponent;
    const cambio = spyOn(selector.seleccionadoChange, 'emit');
    selector.seleccionar('30');
    expect(cambio).toHaveBeenCalledWith(30);
  });
  it('comparte una sola carga activa entre diez selectores y no recarga al cambiar', async () => {
    const many = TestBed.createComponent(ManyHostComponent);
    many.detectChanges();
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([
      { id_litologia: 1, codigo: 'a', nombre: 'A', familia: 'arenisca', color: '#C98C82', patron: 'sandstone_fine', activo: true, orden: 1 },
    ]);
    await many.whenStable();
    many.debugElement.queryAll(By.directive(SelectorLitologiaComponent))[0].componentInstance.seleccionar('1');
    expect(many.debugElement.queryAll(By.directive(SelectorLitologiaComponent)).length).toBe(10);
  });

  it('comparte la carga excepcional de una historica inactiva', async () => {
    const historical = TestBed.createComponent(HistoricalHostComponent);
    historical.detectChanges();
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([]);
    await historical.whenStable();
    http.expectOne((r) => r.url.endsWith('/litologias/7')).flush({ id_litologia: 7, codigo: 'historica', nombre: 'Historica', familia: 'otro', color: '#666666', patron: 'granite', activo: false, orden: 7 });
    await historical.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    historical.detectChanges();
    const selectors = historical.debugElement.queryAll(By.directive(SelectorLitologiaComponent));
    expect(selectors.length).toBe(2);
    expect((selectors[0].componentInstance as SelectorLitologiaComponent).opciones().map((item) => item.id_litologia)).toEqual([7]);
  });
});
