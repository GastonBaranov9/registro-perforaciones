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
    expect(imagen.getAttribute('src')).toBe(`${environment.apiURL}usuarios/7/sitios/12/mapa-aereo`);
    expect(imagen.getAttribute('src')).not.toContain('maps.googleapis.com');
    expect(fixture.nativeElement.textContent).toContain('Google Maps');
  });

  it('distingue coordenadas ausentes e inválidas sin consultar configuración', () => {
    fixture.componentRef.setInput('latitud','');fixture.componentRef.setInput('longitud','');fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Coordenadas no registradas');
  });
});
