import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { SitioPage } from './sitio.page';

describe('SitioPage', () => {
  let component: SitioPage;
  let fixture: ComponentFixture<SitioPage>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [SitioPage, IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(SitioPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  for (const rol of ['propietario', 'perforador', 'administracion']) {
    it(`${rol}: el menú de Sitios sólo ofrece acciones a administración`, () => {
      component.mainStore.setUser({ id_usuario: 7, nombre: 'Usuario', roles: [{ id_rol: 1, nombre: rol, descr: rol }] });
      fixture.detectChanges();
      const texto = fixture.nativeElement.textContent;
      expect(texto.includes('LISTA DE SITIOS')).toBe(rol === 'administracion');
      expect(texto.includes('CREAR UN SITIO')).toBe(rol === 'administracion');
    });
  }

  it('no muestra crear sitio standalone a un perforador', () => {
    component.mainStore.user.set({
      id_usuario: 8,
      email: 'perforador@example.test',
      nombre: 'Perforador',
      activo: true,
      fecha_registro: new Date().toISOString(),
      roles: [{ id_rol: 2, nombre: 'perforador', descr: 'Perforador' }],
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('CREAR UN SITIO');
  });
});
