import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PozosListPage } from './pozos-list.page';
import { PozosListService } from '../../../../shared/services/pozos-list.service';
import { Pozo } from '../../../../shared/types/schemas';
import { ExportarKmlService } from '../../../../shared/services/exportar-kml.service';

describe('PozosListPage', () => {
  let component: PozosListPage;
  let fixture: ComponentFixture<PozosListPage>;
  let servicio: jasmine.SpyObj<PozosListService>;
  let exportador: jasmine.SpyObj<ExportarKmlService>;
  const pozos: Pozo[] = [
    { id_pozo: 8, id_propietario: 1001, id_sitio: 2002, id_perforador: 3, fecha_creado: '2026-08-12T00:00:00Z', empresa: 'Raúl Silva', propietario_nombre: 'José Pérez', sitio_nombre: 'Paso de los Mellizos, Río Negro' },
    { id_pozo: 9, id_propietario: 1002, id_sitio: 2003, id_perforador: 3, fecha_creado: '2026-08-13T00:00:00Z', propietario_nombre: 'Ana Silva', sitio_nombre: 'Padrón 45, Salto' },
  ];

  beforeEach(async () => {
    servicio = jasmine.createSpyObj('PozosListService', ['getListaPozos', 'deletePozo']);
    servicio.getListaPozos.and.resolveTo(pozos);
    exportador = jasmine.createSpyObj('ExportarKmlService', ['descargar']);
    exportador.descargar.and.resolveTo({ exportadas: 12, omitidas: 3 });
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: PozosListService, useValue: servicio }, { provide: ExportarKmlService, useValue: exportador }],
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

  it('operador ve todos los pozos, edita normales e históricos y exporta, sin eliminación', async () => {
    spyOn(component.authService, 'tieneRol').and.callFake(rol => rol === 'operador_administrativo');
    const navegar = spyOn(TestBed.inject(Router), 'navigate');
    component.pozos.set([{ ...pozos[0], origen: 'historico' }, { ...pozos[1], origen: 'normal' }]);
    fixture.detectChanges();
    const botones = fixture.nativeElement.querySelectorAll('[aria-label="Editar pozo"]');
    expect(botones.length).toBe(2);
    botones[0].click();
    expect(navegar).toHaveBeenCalledWith(['/pozos-historicos', 8, 'editar']);
    botones[1].click();
    expect(navegar).toHaveBeenCalledWith(['/pozo-edit', 9]);
    expect(fixture.nativeElement.querySelector('#exportar-kml')).not.toBeNull();
    await component.exportarKml();
    expect(exportador.descargar).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[aria-label="Eliminar pozo"]')).toBeNull();
    await component.borrarPozo(pozos[0]);
    expect(servicio.deletePozo).not.toHaveBeenCalled();
  });

  for (const rol of ['perforador', 'propietario', '']) {
    it(`oculta exportación KML y bloquea invocación para ${rol || 'sin rol'}`, async () => {
      spyOn(component.authService, 'tieneRol').and.callFake(nombre => nombre === rol);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('#exportar-kml')).toBeNull();
      await component.exportarKml();
      expect(exportador.descargar).not.toHaveBeenCalled();
    });
  }

  it('botón administrativo descarga todas las perforaciones y muestra los contadores', async () => {
    spyOn(component.authService, 'tieneRol').and.callFake(rol => rol === 'administracion');
    const present = jasmine.createSpy('present').and.resolveTo();
    const toast = spyOn(component.toastController, 'create').and.resolveTo({ present } as any);
    component.propietarioBusqueda.set('sin coincidencias');
    fixture.detectChanges();
    const boton = fixture.nativeElement.querySelector('#exportar-kml');
    expect(boton.textContent).toContain('Exportar Google Earth (KML)');
    boton.click();
    await fixture.whenStable();
    expect(exportador.descargar).toHaveBeenCalledOnceWith();
    expect(toast).toHaveBeenCalledWith(jasmine.objectContaining({
      message: 'Descarga KML iniciada: 12 exportadas; 3 omitidas por coordenadas o número comercial faltantes o inválidos.', color: 'success',
    }));
    expect(present).toHaveBeenCalled();
    expect(component.exportandoKml()).toBeFalse();
  });

  it('evita descargas duplicadas y deshabilita el botón mientras espera', async () => {
    spyOn(component.authService, 'tieneRol').and.returnValue(true);
    spyOn(component.toastController, 'create').and.resolveTo({ present: async () => {} } as any);
    let resolver!: (valor: { exportadas: number; omitidas: number }) => void;
    exportador.descargar.and.returnValue(new Promise(resolve => resolver = resolve));
    const descarga = component.exportarKml();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#exportar-kml').disabled).toBeTrue();
    await component.exportarKml();
    expect(exportador.descargar).toHaveBeenCalledTimes(1);
    resolver({ exportadas: 0, omitidas: 4 });
    await descarga;
    expect(component.exportandoKml()).toBeFalse();
  });

  it('sin headers informa la descarga sin inventar cantidades', async () => {
    spyOn(component.authService, 'tieneRol').and.returnValue(true);
    exportador.descargar.and.resolveTo({ exportadas: null, omitidas: null });
    const toast = spyOn(component.toastController, 'create').and.resolveTo({ present: async () => {} } as any);
    await component.exportarKml();
    expect(toast).toHaveBeenCalledWith(jasmine.objectContaining({ message: 'Descarga KML iniciada.' }));
  });

  it('informa error de descarga y permite volver a intentar', async () => {
    spyOn(component.authService, 'tieneRol').and.returnValue(true);
    exportador.descargar.and.rejectWith(new Error('sin conexión'));
    const toast = spyOn(component.toastController, 'create').and.resolveTo({ present: async () => {} } as any);
    await component.exportarKml();
    expect(toast).toHaveBeenCalledWith(jasmine.objectContaining({ color: 'danger' }));
    expect(component.exportandoKml()).toBeFalse();
  });

  it('perforador ve edición solo propia reciente y nunca eliminación', async () => {
    spyOn(component.authService, 'tieneRol').and.callFake(rol => rol === 'perforador');
    spyOn(component.authService, 'userId').and.returnValue(7);
    const reciente = { ...pozos[0], creado_por: 7, fecha_creado: new Date().toISOString(), id_propietario: null, propietario_provisional: 'Provisional', numero_perforacion: 2047 };
    component.pozos.set([reciente, { ...pozos[1], creado_por: 7 }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[aria-label="Editar pozo"]').length).toBe(1);
    expect(fixture.nativeElement.querySelector('[aria-label="Eliminar pozo"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Solo lectura');
    await component.borrarPozo(reciente);
    expect(servicio.deletePozo).not.toHaveBeenCalled();
    component.pozos.set([{ ...reciente, creado_por: 8 }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Editar pozo"]')).toBeNull();
  });

  it('administración conserva edición y eliminación de pozos antiguos', () => {
    spyOn(component.authService, 'tieneRol').and.callFake(rol => rol === 'administracion');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[aria-label="Editar pozo"]').length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('[aria-label="Eliminar pozo"]').length).toBe(2);
  });

  it('el lápiz de administración abre directamente el editor correspondiente al origen', () => {
    spyOn(component.authService, 'tieneRol').and.callFake(rol => rol === 'administracion');
    const navegar = spyOn(TestBed.inject(Router), 'navigate');
    component.pozos.set([{ ...pozos[0], origen: 'historico' }, { ...pozos[1], origen: 'normal' }]);
    fixture.detectChanges();
    const botones = fixture.nativeElement.querySelectorAll('[aria-label="Editar pozo"]');
    botones[0].click();
    expect(navegar).toHaveBeenCalledWith(['/pozos-historicos', 8, 'editar']);
    botones[1].click();
    expect(navegar).toHaveBeenCalledWith(['/pozo-edit', 9]);
    expect(navegar.calls.count()).toBe(2);
  });

  it('conserva el editor normal para el perforador autorizado y registros sin origen explícito', () => {
    spyOn(component.authService, 'tieneRol').and.callFake(rol => rol === 'perforador');
    spyOn(component.authService, 'userId').and.returnValue(7);
    const navegar = spyOn(TestBed.inject(Router), 'navigate');
    component.irAEditar({ ...pozos[0], creado_por: 7, fecha_creado: new Date().toISOString() });
    expect(navegar).toHaveBeenCalledOnceWith(['/pozo-edit', 8]);
  });

  it('no muestra el lápiz ni permite navegar sin permiso, incluidos históricos propios recientes', () => {
    spyOn(component.authService, 'tieneRol').and.callFake(rol => rol === 'perforador');
    spyOn(component.authService, 'userId').and.returnValue(7);
    const navegar = spyOn(TestBed.inject(Router), 'navigate');
    const historico: Pozo = { ...pozos[0], origen: 'historico', creado_por: 7, fecha_creado: new Date().toISOString() };
    component.pozos.set([historico, pozos[1]]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Editar pozo"]')).toBeNull();
    component.irAEditar(historico);
    component.irAEditar(pozos[1]);
    expect(navegar).not.toHaveBeenCalled();
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
