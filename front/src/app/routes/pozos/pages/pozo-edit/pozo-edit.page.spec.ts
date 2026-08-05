import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PozoEditPage } from './pozo-edit.page';

describe('PozoEditPage', () => {
  let component: PozoEditPage;
  let fixture: ComponentFixture<PozoEditPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [PozoEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PozoEditPage);
    fixture.componentRef.setInput('id_pozo', 1);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('bloquea doble envío y conserva el borrador mientras guarda', async () => {
    let resolver!: (valor: unknown) => void;
    const pendiente = new Promise((resolve) => { resolver = resolve; });
    const editar = spyOn(component.pozoEditService, 'editPozoCompleto').and.returnValue(pendiente as never);
    const dato = { pozo: { id_propietario: 2, id_perforador: 3, id_sitio: 4 }, foto: null, fotoAccion: 'conservar' as const };
    const primero = component.handleEdit(dato); await component.handleEdit(dato);
    expect(editar).toHaveBeenCalledTimes(1); resolver({}); await primero;
  });

  it('un error mantiene cambios técnicos en memoria', async () => {
    component.datosTecnicos.set({ intervalosLitologicos: [{ idLocal: 'local-1', dato: { desde_m: 0, hasta_m: 1, material: 'Arena' } }], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] });
    spyOn(component.pozoEditService, 'editPozoCompleto').and.rejectWith(new Error('fallo controlado'));
    await component.handleEdit({ pozo: { id_propietario: 2, id_perforador: 3, id_sitio: 4, profundidad_final_m: 10 }, foto: null, fotoAccion: 'conservar' });
    expect(component.datosTecnicos().intervalosLitologicos.length).toBe(1);
    expect(component.errorMessage()).toContain('fallo controlado');
  });

  it('después de actualizar navega al detalle reutilizable que invalida el perfil', async () => {
    spyOn(component.pozoEditService, 'editPozoCompleto').and.resolveTo({} as never);
    const navegar = spyOn(component.router, 'navigate').and.resolveTo(true);
    await component.handleEdit({ pozo: { id_propietario:2,id_perforador:3,id_sitio:4,profundidad_final_m:20 }, foto:null, fotoAccion:'conservar' });
    expect(navegar).toHaveBeenCalledOnceWith(['/pozos-detail', 1]);
  });
});
