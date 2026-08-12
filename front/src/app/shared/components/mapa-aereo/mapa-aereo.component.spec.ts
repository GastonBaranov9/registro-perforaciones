import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '../../../../environments/environment';
import { MapaAereoComponent } from './mapa-aereo.component';

describe('MapaAereoComponent', () => {
  let fixture:ComponentFixture<MapaAereoComponent>;let http:HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({imports:[MapaAereoComponent],providers:[provideHttpClient(),provideHttpClientTesting()]});
    fixture=TestBed.createComponent(MapaAereoComponent);http=TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('idSitio',12);fixture.componentRef.setInput('idUsuario',7);
  });
  afterEach(()=>http.verify());

  it('usa solo el endpoint protegido y preserva la imagen sin crop', async () => {
    fixture.componentRef.setInput('latitud',`31°26'38.1"S`);fixture.componentRef.setInput('longitud',`57°59'11.6"W`);
    fixture.detectChanges();
    http.expectOne(`${environment.apiURL}mapas/estado`).flush({configurado:true,atribucion:'Google Maps'});
    await fixture.whenStable();fixture.detectChanges();
    const imagen=fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(imagen.getAttribute('src')).toBe(`${environment.apiURL}usuarios/7/sitios/12/mapa-aereo?v=31%C2%B026'38.1%22S%2C57%C2%B059'11.6%22W`);
    expect(imagen.getAttribute('src')).not.toContain('maps.googleapis.com');
    expect(fixture.nativeElement.textContent).toContain('Google Maps');
  });

  it('distingue coordenadas ausentes e inválidas sin consultar configuración', () => {
    fixture.componentRef.setInput('latitud','');fixture.componentRef.setInput('longitud','');fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Coordenadas no registradas');
  });

  it('cambia el src determinísticamente cuando cambia la coordenada', async () => {
    fixture.componentRef.setInput('latitud', '-34.913600');fixture.componentRef.setInput('longitud', '-56.161900');fixture.detectChanges();
    http.expectOne(`${environment.apiURL}mapas/estado`).flush({configurado:true,atribucion:'Google Maps'});
    const inicial=fixture.componentInstance.urlImagen();
    fixture.componentRef.setInput('latitud', '-31.443917');fixture.componentRef.setInput('longitud', '-57.986556');fixture.detectChanges();
    expect(fixture.componentInstance.urlImagen()).not.toBe(inicial);
    expect(fixture.componentInstance.urlImagen()).toContain('v=-31.443917%2C-57.986556');
  });

  it('envía coordenadas pendientes al endpoint protegido de preview', () => {
    fixture.componentRef.setInput('preview', true);
    fixture.componentRef.setInput('latitud', '-31.443917');
    fixture.componentRef.setInput('longitud', '-57.986556');
    fixture.detectChanges();
    http.expectOne(`${environment.apiURL}mapas/estado`).flush({configurado:true,atribucion:'Google Maps'});
    expect(fixture.componentInstance.urlImagen()).toBe(
      `${environment.apiURL}usuarios/7/sitios/12/mapa-aereo/preview?latitud=-31.443917&longitud=-57.986556`,
    );
    expect(fixture.componentInstance.urlImagen()).not.toContain('maps.googleapis.com');
  });
});
