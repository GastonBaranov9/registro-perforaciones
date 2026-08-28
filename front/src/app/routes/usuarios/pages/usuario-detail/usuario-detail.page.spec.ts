import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UsuarioDetailPage } from './usuario-detail.page';
import { MainStore } from '../../../../shared/services/mainstore-service/main.store';

describe('UsuarioDetailPage', () => {
  let component: UsuarioDetailPage;
  let fixture: ComponentFixture<UsuarioDetailPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [UsuarioDetailPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UsuarioDetailPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('muestra el perfil web completo cuando el DTO incluye datos administrativos', () => {
    fixture.destroy();
    TestBed.inject(MainStore).setUser({
      id_usuario: 7,
      nombre: 'Usuario Web',
      email: 'web@example.test',
      activo: true,
      fecha_registro: '2026-01-01T00:00:00.000Z',
      roles: [],
    });
    fixture = TestBed.createComponent(UsuarioDetailPage);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('web@example.test');
    expect(text).toContain('Activo');
    expect(text).toContain('Fecha de registro');
  });

  it('oculta campos ausentes del DTO native reducido', () => {
    fixture.destroy();
    TestBed.inject(MainStore).setUser({
      id_usuario: 8,
      nombre: 'Usuario Native',
      roles: [{ id_rol: 2, nombre: 'perforador', descr: 'Perforador' }],
    });
    fixture = TestBed.createComponent(UsuarioDetailPage);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Usuario Native');
    expect(text).toContain('perforador');
    expect(text).not.toContain('Email');
    expect(text).not.toContain('Activo');
    expect(text).not.toContain('Fecha de registro');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });
});
