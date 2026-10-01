import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PozosListPage } from './pozos-list.page';
import { PozosListService } from '../../../../shared/services/pozos-list.service';
import { Pozo } from '../../../../shared/types/schemas';

describe('PozosListPage', () => {
  let component: PozosListPage;
  let fixture: ComponentFixture<PozosListPage>;
  let servicio: jasmine.SpyObj<PozosListService>;
  const pozos: Pozo[] = [
    { id_pozo: 8, id_propietario: 1001, id_sitio: 2002, id_perforador: 3, fecha_creado: '2026-08-12T00:00:00Z', empresa: 'Raúl Silva', propietario_nombre: 'José Pérez', sitio_nombre: 'Paso de los Mellizos, Río Negro' },
    { id_pozo: 9, id_propietario: 1002, id_sitio: 2003, id_perforador: 3, fecha_creado: '2026-08-13T00:00:00Z', propietario_nombre: 'Ana Silva', sitio_nombre: 'Padrón 45, Salto' },
  ];

  beforeEach(async () => {
    servicio = jasmine.createSpyObj('PozosListService', ['getListaPozos', 'deletePozo']);
    servicio.getListaPozos.and.resolveTo(pozos);
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: PozosListService, useValue: servicio }],
      imports: [PozosListPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PozosListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('identifica y busca por número empresarial sin reemplazar el ID de navegación', () => {
    component.pozos.set([{ ...pozos[0], numero_perforacion: 2047 }, pozos[1]]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Perforación N.º 2047');
    expect(fixture.nativeElement.textContent).toContain('Perforación sin número asignado');
    expect(fixture.nativeElement.textContent).toContain('ID interno: 8');
    component.propietarioBusqueda.set('2047');
    expect(component.pozosVisibles().map(p => p.id_pozo)).toEqual([8]);
  });

  it('muestra nombres en lugar de IDs y limita el resumen a identificación y fecha', () => {
    fixture.detectChanges();
    const texto = fixture.nativeElement.textContent as string;
    for (const nombre of ['José Pérez', 'Paso de los Mellizos, Río Negro', 'Ana Silva']) expect(texto).toContain(nombre);
    for (const retirado of ['ID Propietario', 'ID Sitio', '1001', '2002', 'Caudal (lh)', 'Profundidad (m)']) expect(texto).not.toContain(retirado);
  });

  it('busca por nombre parcial sin distinguir tildes, mayúsculas ni espacios externos', () => {
    const input = fixture.nativeElement.querySelector('ion-input[name="propietario"]');
    input.dispatchEvent(new CustomEvent('ionInput', { detail: { value: '  JOSE pe  ' } }));
    fixture.detectChanges();
    expect(component.pozosVisibles().map(p => p.id_pozo)).toEqual([8]);
    expect(fixture.nativeElement.querySelectorAll('ion-card').length).toBe(1);
    input.dispatchEvent(new CustomEvent('ionInput', { detail: { value: '' } }));
    expect(component.pozosVisibles().length).toBe(2);
  });

  it('combina propietario con filtros numéricos y conserva ambos al recargar', async () => {
    component.propietarioBusqueda.set('silva');
    component.caudal_min = 100;
    component.caudal_max = 2000;
    component.profundidad_min = 5;
    component.profundidad_max = 60;
    servicio.getListaPozos.and.resolveTo([pozos[1]]);
    await component.filtrar();
    expect(servicio.getListaPozos).toHaveBeenCalledWith(100, 2000, 60, 5);
    expect(component.pozosVisibles().map(p => p.id_pozo)).toEqual([9]);
    // Cambiar el borrador del modal y cancelarlo no debe aplicar esos valores al recargar.
    component.caudal_min = 999;
    await component.ionViewWillEnter();
    expect(servicio.getListaPozos.calls.mostRecent().args).toEqual([100, 2000, 60, 5]);
    expect(component.propietarioBusqueda()).toBe('silva');
  });

  it('informa búsquedas sin coincidencias y tolera registros sin nombre', () => {
    component.pozos.set([{ ...pozos[0], propietario_nombre: undefined }]);
    component.propietarioBusqueda.set('inexistente');
    fixture.detectChanges();
    expect(component.pozosVisibles()).toEqual([]);
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('No hay pozos');
  });

  it('no muestra ni filtra por los campos técnicos retirados', () => {
    component.pozos.set([{
      id_pozo: 8, id_propietario: 1, id_sitio: 2, id_perforador: 3,
      fecha_creado: '2026-08-12T00:00:00.000Z', sello_sanitario: true,
      pre_filtro: 'Prefiltro histórico',
    }]);
    fixture.detectChanges();
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).not.toContain('Sello sanitario');
    expect(texto).not.toContain('Prefiltro histórico');
  });
});
