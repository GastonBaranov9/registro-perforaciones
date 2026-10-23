import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PozosDetailPage } from './pozos-detail.page';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';

describe('PozosDetailPage', () => {
  let component: PozosDetailPage;
  let fixture: ComponentFixture<PozosDetailPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [PozosDetailPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PozosDetailPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('ofrece edición histórica sólo al administrador, conservando la ruta separada',()=>{
    component.id_pozo=18;
    component.pozo.set({id_pozo:18,numero_perforacion:3281,origen:'historico',id_propietario:null,id_perforador:null,id_sitio:null,fecha_creado:'2026-10-06'});
    const role=spyOn(TestBed.inject(AuthService),'tieneRol').and.callFake(r=>r==='administracion');
    const nav=spyOn(component.router,'navigate').and.resolveTo(true);
    fixture.detectChanges();expect(fixture.nativeElement.textContent).toContain('Editar perforación histórica');
    component.irAEditarHistorico();expect(nav).toHaveBeenCalledWith(['/pozos-historicos',18,'editar']);
    role.and.returnValue(false);nav.calls.reset();fixture.detectChanges();component.irAEditarHistorico();
    expect(nav).not.toHaveBeenCalled();expect(fixture.nativeElement.textContent).not.toContain('Editar perforación histórica');
  });

  it('error HTTP de PDF muestra alerta persistente y permite un segundo intento', async () => {
    spyOn(TestBed.inject(AuthService), 'userId').and.returnValue(1);
    component.id_pozo = 8;
    component.pozo.set({ id_pozo: 8, id_propietario: 1, id_sitio: 2, id_perforador: 3, fecha_creado: '2026-08-12' });
    const pendiente = component.generarPdf();
    expect(component.generandoPdf()).toBeTrue();
    await component.generarPdf();
    TestBed.inject(HttpTestingController).expectOne(environment.apiURL + 'usuarios/1/pozos/8/informe-pdf')
      .flush(new Blob(), { status: 500, statusText: 'Server error' });
    await pendiente;
    // Evita cargar recursos ajenos al PDF en esta prueba del feedback.
    component.pozo.set(undefined);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('No se pudo generar o abrir el PDF');
    expect(component.generandoPdf()).toBeFalse();
    component.pozo.set({ id_pozo: 8, id_propietario: 1, id_sitio: 2, id_perforador: 3, fecha_creado: '2026-08-12' });
    spyOn(component.informeService, 'exportarInformePozo').and.resolveTo();
    await component.generarPdf();
    expect(component.errorPdf()).toBe('');
    expect(component.informeService.exportarInformePozo).toHaveBeenCalledWith(1, 8);
    TestBed.inject(HttpTestingController).verify();
  });

  it('no duplica los campos históricos en el detalle técnico moderno', () => {
    component.pozo.set({
      id_pozo: 8, id_propietario: 1, id_sitio: 2, id_perforador: 3,
      fecha_creado: '2026-08-12T00:00:00.000Z', sello_sanitario: true,
      pre_filtro: 'Prefiltro histórico',
    });
    fixture.detectChanges();
    const texto = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelector('[aria-label="Sello sanitario"]').textContent).toContain('No registrado');
    expect(texto).not.toContain('Desde:');
    expect(texto).not.toContain('Prefiltro histórico');
  });

  it('invalida el perfil cada vez que Ionic vuelve a mostrar el detalle', async () => {
    spyOn(component.pozoEditService, 'getPozoById').and.rejectWith(new Error('sin red'));
    await component.ionViewWillEnter();
    await component.ionViewWillEnter();
    expect(component.versionPerfil()).toBe(2);
    expect(component.pozo()).toBeUndefined();
    expect(component.errorMessage()).toContain('detalle actualizado');
  });
  it('muestra el rango constructivo decimal en su sección independiente', () => {
    component.pozo.set({ id_pozo: 8, id_propietario: 1, id_sitio: 2, id_perforador: 3, fecha_creado: '2026-08-12',
      sello_sanitario_constructivo: { desde_m: 1.125, hasta_m: 9.875 }, sello_sanitario: false });
    fixture.detectChanges();
    const texto = fixture.nativeElement.querySelector('[aria-label="Sello sanitario"]').textContent;
    expect(texto).toContain('Desde: 1.125 m'); expect(texto).toContain('Hasta: 9.875 m');
  });
});
