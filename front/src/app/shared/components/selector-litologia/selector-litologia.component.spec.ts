import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { SelectorLitologiaComponent } from './selector-litologia.component';

@Component({ standalone: true, imports: [SelectorLitologiaComponent], template: '<app-selector-litologia />' })
class HostComponent {}

describe('SelectorLitologiaComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    fixture = TestBed.createComponent(HostComponent); http = TestBed.inject(HttpTestingController); fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/litologias')).flush([
      { id_litologia: 1, codigo: 'arenisca_rosada', nombre: 'Arenisca rosada', familia: 'arenisca', color: '#C98C82', patron: 'sandstone_fine', activo: true, orden: 1 },
      { id_litologia: 2, codigo: 'basalto', nombre: 'Basalto', familia: 'basalto', color: '#555555', patron: 'basalt', activo: true, orden: 2 },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => http.verify());
  it('filtra la búsqueda Are y solo ofrece activas', () => {
    const selector = fixture.debugElement.query(By.directive(SelectorLitologiaComponent)).componentInstance as SelectorLitologiaComponent;
    selector.busqueda.set('Are');
    expect(selector.opcionesFiltradas().map((x) => x.id_litologia)).toEqual([1]);
    expect(selector.opcionesFiltradas().every((x) => x.activo)).toBeTrue();
  });
});
