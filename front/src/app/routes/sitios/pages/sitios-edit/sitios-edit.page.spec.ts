import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SitiosEditPage } from './sitios-edit.page';

describe('SitiosEditPage', () => {
  let component: SitiosEditPage;
  let fixture: ComponentFixture<SitiosEditPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [SitiosEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SitiosEditPage);
    fixture.componentRef.setInput('id_sitio', 1);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('usa coordenadas pendientes para el mapa y vuelve a las persistidas al cancelar', () => {
    component.actualizarMapa({ latitud: '-31.4439167', longitud: '-57.9865556' });
    expect(component.coordenadasPendientesMapa()).toEqual({ latitud: '-31.4439167', longitud: '-57.9865556' });
    component.actualizarMapa(null);
    expect(component.coordenadasPendientesMapa()).toBeNull();
  });
});
