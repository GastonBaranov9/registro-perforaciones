import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PozosCreatePage } from './pozos-create.page';

describe('PozosCreatePage', () => {
  let component: PozosCreatePage;
  let fixture: ComponentFixture<PozosCreatePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [PozosCreatePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PozosCreatePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renderiza los textos de creación en español correcto', () => {
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Crear nueva perforación');
    expect(texto).not.toContain('perforaciÃ³n');
  });

  it('envía una sola vez y navega al detalle', async () => {
    component.nuevoPozo.set({ id_propietario: 1, id_sitio: 2, id_perforador: 3, profundidad_final_m: 20 });
    let resolver!: (value: { pozo: { id_pozo: number } }) => void;
    const pendiente = new Promise<{ pozo: { id_pozo: number } }>((resolve) => (resolver = resolve));
    const crear = spyOn(component.createService, 'createPozoCompleto').and.returnValue(pendiente as never);
    const navegar = spyOn(component.router, 'navigate').and.resolveTo(true);
    const dato = { pozo: component.nuevoPozo(), foto: null };
    const primero = component.guardarPozo(dato);
    await component.guardarPozo(dato);
    expect(crear).toHaveBeenCalledTimes(1);
    resolver({ pozo: { id_pozo: 44 } });
    await primero;
    expect(navegar).toHaveBeenCalledWith(['/pozos-detail', 44]);
  });

  it('un error conserva los datos técnicos preparados', async () => {
    component.nuevoPozo.set({ id_propietario: 1, id_sitio: 2, id_perforador: 3, profundidad_final_m: 20 });
    const borrador = { intervalosLitologicos: [{ idLocal: 'local-1', dato: { desde_m: 0, hasta_m: 10, material: 'Arena' } }], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] };
    component.datosTecnicos.set(borrador);
    spyOn(component.createService, 'createPozoCompleto').and.rejectWith(new Error('fallo controlado'));
    await component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
    expect(component.errorMessage()).toContain('fallo controlado');
    expect(component.datosTecnicos()).toEqual(borrador);
  });
});
