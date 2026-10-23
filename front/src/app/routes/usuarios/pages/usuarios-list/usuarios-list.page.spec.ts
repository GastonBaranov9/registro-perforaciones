import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UsuariosListPage } from './usuarios-list.page';
import { UsuariosListService } from '../../../../shared/services/usuarios-list.service';

describe('UsuariosListPage', () => {
  let component: UsuariosListPage;
  let fixture: ComponentFixture<UsuariosListPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [UsuariosListPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UsuariosListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('eliminar acceso requiere admin y confirmación explícita', async () => {
    const persona = { id_usuario: 4, nombre: 'Prueba', documento_rut: null, email: null, cuenta_acceso: true, activo: true, roles: ['perforador'] };
    const allowed = spyOn(component.auth, 'tieneRol').and.returnValue(false);
    const confirm = spyOn(window, 'confirm').and.returnValue(false);
    const service = TestBed.inject(UsuariosListService);
    const remove = spyOn(service, 'deleteUsuario').and.resolveTo();
    spyOn(service, 'buscarPersonas').and.resolveTo({ personas: [], total: 0 });
    component.personas.set([persona]); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Eliminar acceso');
    await component.eliminar(persona); expect(confirm).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    allowed.and.returnValue(true); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Eliminar acceso');
    await component.eliminar(persona); expect(confirm).toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    confirm.and.returnValue(true); await component.eliminar(persona); expect(remove).toHaveBeenCalledOnceWith(4);
    expect(confirm.calls.mostRecent().args[0]).toContain('perforaciones, fotos y números se conservan');
  });

  it('busca y distingue cuentas de identidades sin acceso por ID', async () => {
    const servicio = TestBed.inject(UsuariosListService);
    const buscar = spyOn(servicio, 'buscarPersonas').and.resolveTo({
      total: 2,
      personas: [
        { id_usuario: 4, nombre: 'Marcelo Bellagamba', documento_rut: null, email: null, cuenta_acceso: false, activo: true, roles: ['propietario'] },
        { id_usuario: 7, nombre: 'Marcelo Bellagamba', documento_rut: null, email: 'marcelo@pozo.com', cuenta_acceso: true, activo: true, roles: ['propietario'] },
      ],
    });
    component.busqueda = 'marcelo';
    await component.buscar(); fixture.detectChanges();
    expect(buscar).toHaveBeenCalledWith('marcelo', 0);
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Identidad sin acceso');
    expect(texto).toContain('Cuenta con acceso');
    expect(texto).toContain('ID 4');
    expect(texto).toContain('ID 7');
  });
});
