import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SitioDetailPage } from './sitio-detail.page';
import { SitiosListService } from '../../../../shared/services/sitios-list.service';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';

describe('SitioDetailPage', () => {
  let component: SitioDetailPage;
  let fixture: ComponentFixture<SitioDetailPage>;

  beforeEach(async () => {
    const sitios = { getSitioById: jasmine.createSpy().and.resolveTo({ id_sitio:1, departamento:'Salto', localidad:null, latitud:null, longitud:null, padron:null }) };
    const auth = { userId: () => 3 };
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: SitiosListService, useValue: sitios }, { provide: AuthService, useValue: auth }],
      imports: [SitioDetailPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SitioDetailPage);
    fixture.componentRef.setInput('id_sitio', 1);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
