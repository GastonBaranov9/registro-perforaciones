import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { PozoPage } from './pozo.page';

describe('PozoPage', () => {
  let component: PozoPage;
  let fixture: ComponentFixture<PozoPage>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [PozoPage, IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(PozoPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  for (const rol of ['propietario', 'perforador', 'administracion', 'operador_administrativo']) {
    it(`${rol}: muestra creación sólo a perforador/administración y conserva consulta`, () => {
      spyOn(component.authService, 'tieneRol').and.callFake(nombre => nombre === rol);
      fixture.detectChanges();
      const texto = fixture.nativeElement.textContent;
      expect(texto.includes('CREAR POZOS')).toBe(rol !== 'propietario');
      expect(texto).toContain('LISTA DE POZOS');
      expect(fixture.nativeElement.querySelector('[link="/pozos-historicos"]') !== null).toBe(['administracion','operador_administrativo'].includes(rol));
      expect(fixture.nativeElement.querySelector('[link="/pozos-numeracion"]') !== null).toBe(rol === 'administracion');
    });
  }
});
