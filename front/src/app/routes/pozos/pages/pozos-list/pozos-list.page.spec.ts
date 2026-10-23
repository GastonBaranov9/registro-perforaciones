import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
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
    servicio = jasmine.createSpyObj('PozosListService', ['getListaPozos', 'deletePozo', 'confirmarEliminacion']);
    servicio.getListaPozos.and.resolveTo(pozos);
    servicio.confirmarEliminacion.and.resolveTo({numero:2047,id_original:8,asignado_en:null,existe:true,reservada:true,proximo:3282,bloqueos:[],elegible:true,token:'desafio'});
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

  describe('confirmación de eliminación definitiva', () => {
    let opciones: any;
    let cerrar: (detalle: { role: string }) => void;
    let alerta: any;
    let presentada: Promise<void>;
    let autorizado: jasmine.Spy;
    const pozo = { ...pozos[0], numero_perforacion: 2047 };

    beforeEach(() => {
      autorizado = spyOn(component.authService, 'tieneRol').and.callFake(rol => rol === 'administracion');
      const cierre = new Promise<{ role: string }>(resolve => cerrar = resolve);
      let mostrar!:()=>void;
      presentada=new Promise<void>(resolve=>mostrar=resolve);
      alerta = {
        present: jasmine.createSpy().and.callFake(async()=>mostrar()),
        remove: jasmine.createSpy(),
        onDidDismiss: () => cierre,
        dismiss: jasmine.createSpy().and.callFake((_data: unknown, role: string) => { cerrar({ role }); return Promise.resolve(true); }),
      };
      spyOn(component.alertController, 'create').and.callFake(async config => { opciones = config; return alerta; });
      spyOn(component.toastController, 'create').and.resolveTo({ present: async () => {} } as any);
      servicio.deletePozo.and.resolveTo();
    });

    async function abrir(prueba=false) {
      const tarea = component.borrarPozo(pozo,prueba);
      await presentada;
      await fixture.whenStable();
      return { tarea };
    }
    function escribir(texto: string) {
      return opciones.buttons.find((b: any) => b.role === 'confirm').handler({ confirmacion: texto, motivo:'Corrección administrativa de prueba' });
    }

    it('identifica número e ID, advierte datos, fotos y reserva; no borra al abrir', async () => {
      const { tarea } = await abrir();
      expect(opciones.subHeader).toContain('2047');
      expect(opciones.subHeader).toContain('ID interno: 8');
      expect(opciones.message).toContain('datos y fotografías');
      expect(opciones.message).toContain('El número seguirá reservado');
      expect(opciones.inputs[0].attributes['aria-label']).toContain('ELIMINAR');
      expect(servicio.deletePozo).not.toHaveBeenCalled();
      cerrar({ role: 'cancel' }); await tarea;
    });

    for (const role of ['cancel', 'backdrop', 'escape', '']) {
      it(`cancelar/cerrar (${role}) nunca elimina`, async () => {
        const { tarea } = await abrir();
        cerrar({ role }); await tarea;
        expect(servicio.deletePozo).not.toHaveBeenCalled();
        expect(component.eliminando()).toBeFalse();
      });
    }

    it('exige el texto exacto y no acepta sólo el rol confirm', async () => {
      const { tarea } = await abrir();
      for (const texto of ['', 'eliminar', ' ELIMINAR', 'ELIMINAR ']) expect(escribir(texto)).toBeFalse();
      expect(alerta.message).toContain('Completá ELIMINAR');
      cerrar({ role: 'confirm' }); await tarea;
      expect(servicio.deletePozo).not.toHaveBeenCalled();
    });

    it('confirmación válida elimina una vez y actualiza el listado', async () => {
      const { tarea } = await abrir();
      expect(escribir('ELIMINAR')).toBeTrue();
      expect(servicio.deletePozo).not.toHaveBeenCalled();
      cerrar({ role: 'confirm' }); await tarea;
      expect(servicio.deletePozo).toHaveBeenCalledOnceWith(8,jasmine.objectContaining({token:'desafio',confirmacion:'ELIMINAR',prueba_confirmada:false}));
      expect(component.pozos().map(p => p.id_pozo)).toEqual([9]);
      expect(component.eliminando()).toBeFalse();
    });

    it('retroceder cancela incluso con texto válido', async () => {
      const { tarea } = await abrir();
      escribir('ELIMINAR'); component.ionViewWillLeave(); await tarea;
      expect(alerta.dismiss).toHaveBeenCalledWith(undefined, 'cancel');
      expect(servicio.deletePozo).not.toHaveBeenCalled();
    });
    it('eliminar prueba exige declaración expresa además del motivo',async()=>{
      const {tarea}=await abrir(true);
      const confirmar=opciones.buttons.find((b:any)=>b.role==='confirm').handler;
      expect(confirmar({confirmacion:'ELIMINAR',motivo:'Prueba ficticia'})).toBeFalse();
      expect(confirmar({confirmacion:'ELIMINAR',motivo:'Prueba ficticia',declaracion:'PRUEBA SIN REFERENCIAS'})).toBeTrue();
      expect(servicio.deletePozo).not.toHaveBeenCalled();cerrar({role:'confirm'});await tarea;
      expect(servicio.deletePozo).toHaveBeenCalledOnceWith(8,jasmine.objectContaining({prueba_confirmada:true,sin_referencias_externas:true}));
    });
    it('un bloqueo del servidor no abre confirmación ni permite borrar',async()=>{
      servicio.confirmarEliminacion.and.resolveTo({numero:2047,id_original:8,asignado_en:null,existe:true,reservada:true,proximo:3282,bloqueos:['Referencia histórica'],elegible:false,token:null});
      await component.borrarPozo(pozo,true);
      expect(component.alertController.create).not.toHaveBeenCalled();expect(servicio.deletePozo).not.toHaveBeenCalled();
    });

    it('salir antes de terminar de crear el diálogo tampoco lo abre ni elimina', async () => {
      const tarea = component.borrarPozo(pozo);
      component.ionViewWillLeave(); await tarea;
      expect(alerta.present).not.toHaveBeenCalled();
      expect(component.alertController.create).not.toHaveBeenCalled();
      expect(servicio.deletePozo).not.toHaveBeenCalled();
    });

    it('revalida el rol administrativo antes de enviar la eliminación', async () => {
      const { tarea } = await abrir();
      escribir('ELIMINAR'); autorizado.and.returnValue(false);
      cerrar({ role: 'confirm' }); await tarea;
      expect(servicio.deletePozo).not.toHaveBeenCalled();
    });

    it('evita doble diálogo y doble petición mientras está pendiente', async () => {
      let terminar!: () => void;
      servicio.deletePozo.and.returnValue(new Promise<void>(resolve => terminar = resolve));
      const { tarea } = await abrir();
      await component.borrarPozo(pozos[1]);
      expect(component.alertController.create).toHaveBeenCalledTimes(1);
      escribir('ELIMINAR'); cerrar({ role: 'confirm' }); await fixture.whenStable();
      fixture.detectChanges();
      for (const boton of fixture.nativeElement.querySelectorAll('[aria-label="Eliminar pozo"]')) expect(boton.disabled).toBeTrue();
      await component.borrarPozo(pozo);
      expect(servicio.deletePozo).toHaveBeenCalledTimes(1);
      terminar(); await tarea;
    });

    for (const error of [new Error('conexión'), { error: { message: 'No autorizado' } }]) {
      it('conserva el listado y muestra error sin reintentar automáticamente', async () => {
        servicio.deletePozo.and.rejectWith(error);
        const { tarea } = await abrir();
        escribir('ELIMINAR'); cerrar({ role: 'confirm' }); await tarea;
        expect(servicio.deletePozo).toHaveBeenCalledTimes(1);
        expect(component.pozos().map(p => p.id_pozo)).toEqual([8, 9]);
        expect(component.toastController.create).toHaveBeenCalledWith(jasmine.objectContaining({ color: 'danger', message: jasmine.any(String) }));
        expect(component.eliminando()).toBeFalse();
      });
    }

    it('HttpClient no emite DELETE antes de la confirmación; después emite sólo uno', async () => {
      spyOn(component.authService, 'userId').and.returnValue(7);
      const real = TestBed.runInInjectionContext(() => new PozosListService());
      servicio.deletePozo.and.callFake((id,body) => real.deletePozo(id,body));
      const http = TestBed.inject(HttpTestingController);
      const { tarea } = await abrir();
      http.expectNone(req => req.method === 'DELETE');
      escribir('incorrecto');
      http.expectNone(req => req.method === 'DELETE');
      escribir('ELIMINAR');
      http.expectNone(req => req.method === 'DELETE');
      cerrar({ role: 'confirm' }); await Promise.resolve(); await fixture.whenStable();
      expect(servicio.deletePozo).toHaveBeenCalledTimes(1);
      const req = http.expectOne(req => req.method === 'DELETE');
      expect(req.request.url).toContain('usuarios/7/pozos/8');
      req.flush(null, { status: 204, statusText: 'No Content' });
      await tarea; http.verify();
    });
  });

  it('operador edita históricos sin acceso a edición normal ajena ni KML global', async () => {
    spyOn(component.authService, 'tieneRol').and.callFake(rol => rol === 'operador_administrativo');
    const navegar = spyOn(TestBed.inject(Router), 'navigate');
    component.pozos.set([{ ...pozos[0], origen: 'historico' }, { ...pozos[1], origen: 'normal' }]);
    fixture.detectChanges();
    const botones = fixture.nativeElement.querySelectorAll('[aria-label="Editar pozo"]');
    expect(botones.length).toBe(1);
    botones[0].click();
    expect(navegar).toHaveBeenCalledWith(['/pozos-historicos', 8, 'editar']);
    expect(fixture.nativeElement.querySelector('#exportar-kml')).toBeNull();
    await component.exportarKml();
    expect(exportador.descargar).not.toHaveBeenCalled();
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
