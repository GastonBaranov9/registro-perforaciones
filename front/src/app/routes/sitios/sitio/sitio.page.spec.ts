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
