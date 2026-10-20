import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PozoEditPage } from './pozo-edit.page';
import { Sitio } from '../../../../shared/types/schemas';
import { SitiosEditService } from '../../../../shared/services/sitios-edit.service';
import { PozosEditService } from '../../../../shared/services/pozos-edit.service';
import { CandidatosPozoService } from '../../../../shared/services/candidatos-pozo.service';
import { IntervaloLitologicoListService } from '../../../../shared/services/intervalo-lit-service/intervalo-lit-list/intervalo-litologico-list.service';
import { IntervaloDiametroListService } from '../../../../shared/services/intervalo-diametro-service/intervalo-diemtro-list/intervalo-diametro-list.service';
import { IntervalosFiltroService } from '../../../../shared/services/intervalos-filtro.service';
import { AporteListService } from '../../../../shared/services/aportes-service/aporte-list-service/aporte-list.service';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { HttpTestingController } from '@angular/common/http/testing';

function respuestaGuardada() {
  return { pozo: { id_pozo: 1 }, sello_sanitario_constructivo: null, intervalos_litologicos: [], intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [] };
}

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
    spyOn(component.authService, 'tieneRol').and.callFake(rol => rol === 'administracion');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('perforador edita ubicación dentro del pozo y conserva cambios técnicos y foto', async () => {
    (component.authService.tieneRol as jasmine.Spy).and.callFake(rol => rol === 'perforador');
    spyOn(component.authService, 'userId').and.returnValue(7);
    const sitio: Sitio = { id_sitio: 4, departamento: 'Salto', latitud: '-31', longitud: '-57' };
    const pozo = { id_sitio: 4, creado_por: 7, fecha_creado: new Date().toISOString() };
    spyOn(component.pozoResource, 'value').and.returnValue({ pozo, sitios: [sitio] } as never);
    const navegar = spyOn(component.router, 'navigate');
    const reload = spyOn(component.pozoResource, 'reload');
    const tecnicos = component.datosTecnicos();
    const foto = new File(['foto'], 'pendiente.jpg');
    component.formulario = { fotoFile: foto } as NonNullable<PozoEditPage['formulario']>;
    component.editarSitio();
    expect(component.sitioEnEdicion()).toEqual(sitio);
    expect(component.sitioEnEdicion()).not.toBe(sitio);
    expect(navegar).not.toHaveBeenCalled();
    const nuevo = { ...sitio, latitud: '-32' };
    const guardar = spyOn(TestBed.inject(SitiosEditService), 'editSitio').and.resolveTo(nuevo);
    await component.guardarUbicacion(nuevo);
    expect(guardar).toHaveBeenCalledOnceWith(4, nuevo);
    expect(component.sitiosActualizados()).toEqual([nuevo]);
    expect(component.sitioEnEdicion()).toBeNull();
    expect(component.datosTecnicos()).toBe(tecnicos);
    expect(component.formulario!.fotoFile).toBe(foto);
    expect(reload).not.toHaveBeenCalled();
  });
  it('ubicación denegada conserva edición y revalida el plazo al guardar', async () => {
    const sitio: Sitio = { id_sitio: 4, departamento: 'Salto' };
    spyOn(component.pozoResource, 'value').and.returnValue({ pozo: { id_sitio: 4 }, sitios: [sitio] } as never);
    const permiso = spyOn(component.permisos, 'puedeEditar').and.returnValue(true);
    component.sitioEnEdicion.set(sitio);
    const guardar = spyOn(TestBed.inject(SitiosEditService), 'editSitio').and.rejectWith(new Error('Sitio compartido: sin permiso'));
    await component.guardarUbicacion(sitio);
    expect(component.errorMessage()).toContain('sin permiso');
    expect(component.sitioEnEdicion()).toBe(sitio);
    expect(component.disabled()).toBeFalse();
    permiso.and.returnValue(false); guardar.calls.reset();
    await component.guardarUbicacion(sitio);
    expect(guardar).not.toHaveBeenCalled();
  });
  it('administración conserva el editor standalone de Sitios', () => {
    spyOn(component.pozoResource, 'value').and.returnValue({ pozo: { id_sitio: 4 } } as never);
    const navegar = spyOn(component.router, 'navigate');
    component.editarSitio();
    expect(navegar).toHaveBeenCalledWith(['/sitios-edit', 4], { state: { returnTo: component.router.url } });
    expect(component.sitioEnEdicion()).toBeNull();
  });

  it('rechaza un guardado al vencer el plazo sin llamar a la API ni perder borrador', async () => {
    (component.authService.tieneRol as jasmine.Spy).and.callFake(rol => rol === 'perforador');
    spyOn(component.authService, 'userId').and.returnValue(7);
    spyOn(component.pozoResource, 'value').and.returnValue({ pozo: { creado_por: 7, fecha_creado: '2000-01-01T00:00:00Z' } } as never);
    const editar = spyOn(component.pozoEditService, 'editPozoCompleto');
    component.borradorDirty.set(true);
    await component.handleEdit({ pozo: { id_propietario: null, propietario_provisional: 'Provisional', id_perforador: 7, id_sitio: 4 }, foto: null, fotoAccion: 'conservar' });
    expect(editar).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('Solo lectura');
    expect(component.borradorDirty()).toBeTrue();
  });

  it('vincular conserva el borrador técnico y la foto pendiente sin recargar', () => {
    const pozo={id_propietario:null as number|null,propietario_provisional:'Provisional' as string|null,id_perforador:3,id_sitio:4,numero_perforacion:3001};
    const editor={pozo,personas:{propietarios:[],perforadores:[]},sitios:[],tecnicos:component.datosTecnicos()};
    spyOn(component.pozoResource,'value').and.returnValue(editor as never);
    const reload=spyOn(component.pozoResource,'reload');
    const borrador=component.datosTecnicos();
    const foto=new File(['foto'],'pendiente.jpg');
    component.formulario={fotoFile:foto} as NonNullable<PozoEditPage['formulario']>;
    component.borradorDirty.set(true);
    component.propietarioVinculado({id_usuario:7,nombre:'Verificado',roles:['propietario']});
    expect(pozo.id_propietario).toBe(7);expect(pozo.propietario_provisional).toBeNull();
    expect(pozo.numero_perforacion).toBe(3001);
    expect(component.datosTecnicos()).toBe(borrador);
    expect(component.formulario!.fotoFile).toBe(foto);
    expect(component.borradorDirty()).toBeTrue();expect(reload).not.toHaveBeenCalled();
  });

  it('bloquea recarga mientras vincula', () => {
    component.vinculando.set(true);const reload=spyOn(component.pozoResource,'reload');
    component.recargar();expect(reload).not.toHaveBeenCalled();
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
    spyOn(component.pozoEditService, 'editPozoCompleto').and.resolveTo({ ...respuestaGuardada(), pozo: { foto_url: '/usuarios/1/pozos/1/foto' } } as never);
    spyOn(component.router, 'navigate').and.resolveTo(true);
    await component.handleEdit({ pozo: { id_propietario: 1, id_perforador: 1, id_sitio: 1 }, foto: new File(['foto'], 'nueva.jpg'), fotoAccion: 'reemplazar' });
    expect(component.errorMessage()).toBe('');
    expect(confirmar).toHaveBeenCalledOnceWith('/usuarios/1/pozos/1/foto');
  });

  it('bloquea doble envío y conserva el borrador mientras guarda', async () => {
    let resolver!: (valor: unknown) => void;
    const pendiente = new Promise((resolve) => { resolver = resolve; });
    const editar = spyOn(component.pozoEditService, 'editPozoCompleto').and.returnValue(pendiente as never);
    const dato = { pozo: { id_propietario: 2, id_perforador: 3, id_sitio: 4 }, foto: null, fotoAccion: 'conservar' as const };
    const primero = component.handleEdit(dato); await component.handleEdit(dato);
    expect(editar).toHaveBeenCalledTimes(1); resolver(respuestaGuardada()); await primero;
  });

  it('un error mantiene cambios técnicos en memoria', async () => {
    component.datosTecnicos.set({ intervalosLitologicos: [{ idLocal: 'persistido-1', dato: { id_intervalo_litologico: 1, desde_m: 0, hasta_m: 1, material: 'Arena' } }], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] });
    spyOn(component.pozoEditService, 'editPozoCompleto').and.rejectWith(new Error('fallo controlado'));
    await component.handleEdit({ pozo: { id_propietario: 2, id_perforador: 3, id_sitio: 4, profundidad_final_m: 10 }, foto: null, fotoAccion: 'conservar' });
    expect(component.datosTecnicos().intervalosLitologicos.length).toBe(1);
    expect(component.errorMessage()).toContain('fallo controlado');
  });

  it('después de actualizar navega al detalle reutilizable que invalida el perfil', async () => {
    spyOn(component.pozoEditService, 'editPozoCompleto').and.resolveTo(respuestaGuardada() as never);
    const navegar = spyOn(component.router, 'navigate').and.resolveTo(true);
    await component.handleEdit({ pozo: { id_propietario:2,id_perforador:3,id_sitio:4,profundidad_final_m:20 }, foto:null, fotoAccion:'conservar' });
    expect(component.errorMessage()).toBe('');
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

describe('Edición normal del sello sanitario constructivo', () => {
  for (const sello of [null, { desde_m: 1.125, hasta_m: 9.875 }]) {
    it('hidrata exactamente sin dirty ni usar el booleano y detecta reversiones: ' + JSON.stringify(sello), async () => {
      TestBed.configureTestingModule({ imports: [PozoEditPage], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
      const auth = TestBed.inject(AuthService);
      spyOn(auth, 'tieneRol').and.returnValue(true); spyOn(auth, 'userId').and.returnValue(9);
      spyOn(TestBed.inject(PozosEditService), 'getPozoById').and.resolveTo({ id_pozo: 1, id_propietario: null, propietario_provisional: 'Campo',
        id_perforador: 3, id_sitio: 4, fecha_creado: new Date().toISOString(), profundidad_final_m: 30,
        sello_sanitario: true, sello_sanitario_constructivo: sello } as never);
      spyOn(TestBed.inject(CandidatosPozoService), 'obtener').and.resolveTo({ propietarios: [], perforadores: [{ id_usuario: 3, nombre: 'Perforador', roles: ['perforador'] }] });
      spyOn(TestBed.inject(IntervaloLitologicoListService), 'getIntervalosLitologicos').and.resolveTo([]);
      spyOn(TestBed.inject(IntervaloDiametroListService), 'getIntervalosDiametros').and.resolveTo([]);
      spyOn(TestBed.inject(IntervalosFiltroService), 'listar').and.resolveTo([]);
      spyOn(TestBed.inject(AporteListService), 'getNivelesAporte').and.resolveTo([]);
      const fixture = TestBed.createComponent(PozoEditPage); fixture.componentRef.setInput('id_pozo', 1);
      fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      const component = fixture.componentInstance;
      expect(component.datosTecnicos().sello_sanitario_constructivo).toEqual(sello);
      expect(component.tieneCambiosSinGuardar()).toBeFalse();
      if (sello) {
        component.datosTecnicos().sello_sanitario_constructivo!.hasta_m = 10;
        expect(component.tieneCambiosSinGuardar()).toBeTrue();
        component.datosTecnicos().sello_sanitario_constructivo!.hasta_m = 9.875;
        expect(component.tieneCambiosSinGuardar()).toBeFalse();
      }
      TestBed.inject(HttpTestingController).match(() => true).forEach(req => req.flush(null));
    });
  }
});
