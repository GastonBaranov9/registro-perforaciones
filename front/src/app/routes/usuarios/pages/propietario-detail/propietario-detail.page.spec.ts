import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { PropietariosOperativosService } from '../../../../shared/services/propietarios-operativos.service';
import { UsuariosListService } from '../../../../shared/services/usuarios-list.service';
import { PropietarioDetailPage } from './propietario-detail.page';

describe('PropietarioDetailPage', () => {
  let fixture: ComponentFixture<PropietarioDetailPage>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [PropietarioDetailPage],
    }).compileComponents();
    fixture = TestBed.createComponent(PropietarioDetailPage);
    fixture.componentRef.setInput('id_usuario', 4);
  });

  it('muestra el número comercial y el pendiente sin usar el ID técnico como carpeta', async () => {
    spyOn(TestBed.inject(PropietariosOperativosService), 'obtener').and.resolveTo({
      id_usuario: 4, nombre: 'Ana Pérez', documento_rut: null, telefono: null,
      email: null, direccion: null, localidad: null, departamento: null, observaciones: null,
    });
    spyOn(TestBed.inject(UsuariosListService), 'perforacionesDe').and.resolveTo({ total: 2, perforaciones: [
      { id_pozo: 12, numero_perforacion: 3001, fecha_creado: '2026-10-02T00:00:00Z', ubicacion: 'Salto' },
      { id_pozo: 13, numero_perforacion: null, fecha_creado: '2026-10-02T00:00:00Z', ubicacion: 'Artigas' },
    ] });
    fixture.detectChanges();
    await fixture.componentInstance.ionViewWillEnter(); fixture.detectChanges();
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Perforaciones asociadas');
    expect(texto).toContain('Total: 2');
    expect(texto).toContain('Carpeta 3001');
    expect(texto).toContain('Pendiente de numeración');
    expect(texto).toContain('ID técnico 12');
  });
});
