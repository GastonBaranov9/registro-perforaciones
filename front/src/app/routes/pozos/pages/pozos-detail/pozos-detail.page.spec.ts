import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PozosDetailPage } from './pozos-detail.page';

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

  it('no duplica los campos históricos en el detalle técnico moderno', () => {
    component.pozo.set({
      id_pozo: 8, id_propietario: 1, id_sitio: 2, id_perforador: 3,
      fecha_creado: '2026-08-12T00:00:00.000Z', sello_sanitario: true,
      pre_filtro: 'Prefiltro histórico',
    });
    fixture.detectChanges();
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).not.toContain('Sello sanitario');
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
});
