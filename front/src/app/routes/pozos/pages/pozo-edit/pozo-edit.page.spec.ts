import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PozoEditPage } from './pozo-edit.page';
import { Sitio } from '../../../../shared/types/schemas';

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

  it('fallar el reemplazo no confirma la foto ni navega y explica que sigue pendiente', async () => {
    const confirmar = jasmine.createSpy('confirmarFotoGuardada');
    component.formulario = { confirmarFotoGuardada: confirmar } as never;
    spyOn(component.pozoEditService, 'editPozoCompleto').and.rejectWith(new Error('Sin conexión'));
    const navegar = spyOn(component.router, 'navigate');
    await component.handleEdit({ pozo: { id_propietario: 1, id_perforador: 1, id_sitio: 1 }, foto: new File(['foto'], 'nueva.jpg'), fotoAccion: 'reemplazar' });
    expect(confirmar).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('pendientes de guardar');
    expect(component.disabled()).toBeFalse();
  });

  it('confirma el estado de la foto solo después de guardar correctamente', async () => {
    const confirmar = jasmine.createSpy('confirmarFotoGuardada');
    component.formulario = { confirmarFotoGuardada: confirmar } as never;
    spyOn(component.pozoEditService, 'editPozoCompleto').and.resolveTo({ pozo: { foto_url: '/usuarios/1/pozos/1/foto' } } as never);
    spyOn(component.router, 'navigate').and.resolveTo(true);
    await component.handleEdit({ pozo: { id_propietario: 1, id_perforador: 1, id_sitio: 1 }, foto: new File(['foto'], 'nueva.jpg'), fotoAccion: 'reemplazar' });
    expect(confirmar).toHaveBeenCalledOnceWith('/usuarios/1/pozos/1/foto');
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
    component.datosTecnicos.set({ intervalosLitologicos: [{ idLocal: 'persistido-1', dato: { id_intervalo_litologico: 1, desde_m: 0, hasta_m: 1, material: 'Arena' } }], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] });
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

  it('cancelar recarga con dirty conserva el borrador local', () => {
    component.borradorDirty.set(true);spyOn(window,'confirm').and.returnValue(false);const recargar=spyOn(component.pozoResource,'reload');const version=component.versionDescartar();
    component.recargar();expect(recargar).not.toHaveBeenCalled();expect(component.borradorDirty()).toBeTrue();expect(component.versionDescartar()).toBe(version);
  });

  it('confirmar recarga descarta dirty y solicita datos remotos nuevos', () => {
    component.borradorDirty.set(true);spyOn(window,'confirm').and.returnValue(true);const recargar=spyOn(component.pozoResource,'reload');const version=component.versionDescartar();
    component.recargar();expect(recargar).toHaveBeenCalledTimes(1);expect(component.borradorDirty()).toBeFalse();expect(component.versionDescartar()).toBe(version+1);
  });
  it('consume el sitio guardado al volver sin recargar ni perder el borrador técnico', () => {
    const sitioA: Sitio = { id_sitio: 4, departamento: 'Salto', localidad: 'Salto', latitud: '-34.9', longitud: '-56.1' };
    const sitioB: Sitio = { ...sitioA, departamento: 'Paysandú', localidad: 'Guaviyú', latitud: '-31.4', longitud: '-57.9' };
    component.sitiosActualizados.set([sitioA]);
    const borrador = { intervalosLitologicos: [{ idLocal: 'draft', dato: { desde_m: 0, hasta_m: 1, material: 'Arena' } }], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] };
    component.datosTecnicos.set(borrador);
    component.sitioReturn.sitioCreado.set(sitioB);
    const reload = spyOn(component.pozoResource, 'reload');
    component.ionViewWillEnter();
    expect(component.sitiosActualizados()).toEqual([sitioB]);
    expect(component.datosTecnicos()).toBe(borrador);
    expect(reload).not.toHaveBeenCalled();
    expect(component.sitioReturn.sitioCreado()).toBeNull();
  });
  it('ignora un retorno de otro sitio y no lo reaplica', () => {
    const sitioA: Sitio = { id_sitio: 4, departamento: 'Salto' };
    const sitioAjeno: Sitio = { id_sitio: 9, departamento: 'Paysandú' };
    component.sitiosActualizados.set([sitioA]);
    component.sitioReturn.sitioCreado.set(sitioAjeno);
    component.ionViewWillEnter();
    expect(component.sitiosActualizados()).toEqual([sitioA]);
    expect(component.sitioReturn.sitioCreado()).toBeNull();
  });
  it('sin retorno conserva el sitio local y los retornos consecutivos reemplazan por identidad', () => {
    const sitioA: Sitio = { id_sitio: 4, departamento: 'Salto' };
    const sitioB: Sitio = { id_sitio: 4, departamento: 'Paysandú' };
    const sitioC: Sitio = { id_sitio: 4, departamento: 'Guaviyú' };
    component.sitiosActualizados.set([sitioA]);
    component.ionViewWillEnter();
    expect(component.sitiosActualizados()).toEqual([sitioA]);
    component.sitioReturn.sitioCreado.set(sitioB); component.ionViewWillEnter();
    component.sitioReturn.sitioCreado.set(sitioC); component.ionViewWillEnter();
    expect(component.sitiosActualizados()).toEqual([sitioC]);
  });
});
