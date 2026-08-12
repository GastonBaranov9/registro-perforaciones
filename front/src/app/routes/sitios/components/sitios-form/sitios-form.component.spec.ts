import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { SitiosFormComponent } from './sitios-form.component';

describe('SitiosFormComponent', () => {
  let component: SitiosFormComponent;
  let fixture: ComponentFixture<SitiosFormComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [SitiosFormComponent, IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(SitiosFormComponent);
    fixture.componentRef.setInput('sitio', { departamento: 'Montevideo' });
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('no sobrescribe coordenadas actuales al cancelar una captura pendiente', () => {
    fixture.componentRef.setInput('sitio', { departamento: 'Salto', latitud: '-31', longitud: '-57' });
    component.ubicacionPendiente.set({ latitud: '-32', longitud: '-58', precision: 12 });
    component.cancelarUbicacion();
    const emitir = spyOn(component.saved, 'emit');
    component.handleSitio();
    expect(emitir).toHaveBeenCalledWith(jasmine.objectContaining({ latitud: '-31', longitud: '-57' }));
  });

  it('normaliza entrada DMS manual antes de guardar', () => {
    fixture.componentRef.setInput('sitio', { departamento:'Salto',latitud:`31°26'38.1"S`,longitud:`57°59'11.6"W` });
    component.normalizarCoordenada('latitud');component.normalizarCoordenada('longitud');
    const emitir=spyOn(component.saved,'emit');component.handleSitio();
    expect(emitir).toHaveBeenCalledWith(jasmine.objectContaining({latitud:'-31.4439167',longitud:'-57.9865556'}));
  });
});
