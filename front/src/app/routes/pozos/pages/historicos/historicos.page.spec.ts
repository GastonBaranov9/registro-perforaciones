import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { PozosEditService } from '../../../../shared/services/pozos-edit.service';
import { IntervaloLitologicoListService } from '../../../../shared/services/intervalo-lit-service/intervalo-lit-list/intervalo-litologico-list.service';
import { IntervaloDiametroListService } from '../../../../shared/services/intervalo-diametro-service/intervalo-diemtro-list/intervalo-diametro-list.service';
import { IntervalosFiltroService } from '../../../../shared/services/intervalos-filtro.service';
import { AporteListService } from '../../../../shared/services/aportes-service/aporte-list-service/aporte-list.service';
import { HistoricosPage } from './historicos.page';
import { CandidatosPozoService } from '../../../../shared/services/candidatos-pozo.service';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { environment } from '../../../../../environments/environment';
import { PozosFormComponent } from '../../components/pozos-form/pozos-form.component';
import { By } from '@angular/platform-browser';
import { LitologiasService } from '../../../../shared/services/litologias.service';
import { SelectorLitologiaComponent } from '../../../../shared/components/selector-litologia/selector-litologia.component';
import { cambiosPerforacionGuard, ConfirmarSalidaPerforacionService } from '../../../../core/guards/cambios-perforacion.guard';
import { PropietariosOperativosService } from '../../../../shared/services/propietarios-operativos.service';
import { DatosTecnicosBorradorComponent } from '../../components/datos-tecnicos-borrador/datos-tecnicos-borrador.component';
import { ProtectedResourceService } from '../../../../core/resources/protected-resource.service';
import { of } from 'rxjs';
import { CampoTecnicoEstandar, DATOS_TECNICOS_ESTANDAR } from '../../../../shared/constants/datos-tecnicos-estandar';
import { Pozo } from '../../../../shared/types/schemas';

describe('Carga histórica separada',()=>{
  let page:HistoricosPage,http:HttpTestingController;
  const epoch='11111111-1111-4111-8111-111111111111';
  const storage=`historico-pendiente:${environment.apiURL}:1`;
  beforeEach(()=>{
    sessionStorage.removeItem(storage);
    TestBed.configureTestingModule({imports:[HistoricosPage],providers:[provideHttpClient(),provideHttpClientTesting(),provideRouter([]),
      {provide:AuthService,useValue:{userId:()=>1,puedeGestionarHistoricos:()=>true,puedeAdministrarUsuarios:()=>true}},
      {provide:CandidatosPozoService,useValue:{obtener:async()=>({propietarios:[],perforadores:[]})}}]});
    page=TestBed.createComponent(HistoricosPage).componentInstance;http=TestBed.inject(HttpTestingController);
  });
  afterEach(()=>{http.verify();sessionStorage.removeItem(storage);});

  it('operador selecciona personas existentes y carga técnicos, sin crear ni editar identidades', async () => {
    spyOn(TestBed.inject(AuthService), 'puedeAdministrarUsuarios').and.returnValue(false);
    const fixture = TestBed.createComponent(HistoricosPage);
    page = fixture.componentInstance;
    page.cargado.set(true);
    fixture.detectChanges();
    const formulario = fixture.debugElement.query(By.directive(PozosFormComponent)).componentInstance as PozosFormComponent;
    expect(formulario.seleccionarPropietarios()).toBeTrue();
    expect(formulario.administrarPropietarios()).toBeFalse();
    expect(fixture.nativeElement.textContent).not.toContain('REGISTRAR PROPIETARIO');
    expect(fixture.nativeElement.textContent).not.toContain('EDITAR DATOS DEL PROPIETARIO');
    expect(fixture.debugElement.query(By.directive(DatosTecnicosBorradorComponent))).not.toBeNull();
    const crear = spyOn(TestBed.inject(PropietariosOperativosService), 'crear');
    const actualizar = spyOn(TestBed.inject(PropietariosOperativosService), 'actualizar');
    await page.crearPropietario({ nombre: 'Intento' });
    await page.actualizarPropietario({ id: 5, body: { nombre: 'Intento' } });
    expect(crear).not.toHaveBeenCalled(); expect(actualizar).not.toHaveBeenCalled();
  });

  async function cargarEdicionPrueba(textos: Partial<Record<CampoTecnicoEstandar, string | null>> = {}, sello?: Pozo['sello_sanitario_constructivo']) {
    const fixture = TestBed.createComponent(HistoricosPage);
    fixture.componentRef.setInput('id_pozo', '18'); page = fixture.componentInstance;
    spyOn(TestBed.inject(PozosEditService), 'getPozoById').and.resolveTo({
      id_pozo: 18, numero_perforacion: 3281, origen: 'historico', id_sitio: null,
      id_propietario: null, id_perforador: null, fecha_creado: '2026-10-06',
      ...textos, sello_sanitario_constructivo: sello,
    } as Pozo); // La API puede devolver null aunque Pozo sólo declare string opcional.
    spyOn(TestBed.inject(IntervaloLitologicoListService), 'getIntervalosLitologicos').and.resolveTo([]);
    spyOn(TestBed.inject(IntervaloDiametroListService), 'getIntervalosDiametros').and.resolveTo([]);
    spyOn(TestBed.inject(IntervalosFiltroService), 'listar').and.resolveTo([]);
    spyOn(TestBed.inject(AporteListService), 'getNivelesAporte').and.resolveTo([]);
    await page.ionViewWillEnter(); fixture.detectChanges(); await fixture.whenStable();
    return fixture;
  }

  it('el histórico nuevo inicia con los cuatro estándares sin cambios pendientes', async () => {
    const fixture = TestBed.createComponent(HistoricosPage); page = fixture.componentInstance;
    expect(page.pozo()).toEqual(jasmine.objectContaining(DATOS_TECNICOS_ESTANDAR));
    await page.ionViewWillEnter(); fixture.detectChanges(); await fixture.whenStable();
    expect(page.pozo()).toEqual(jasmine.objectContaining(DATOS_TECNICOS_ESTANDAR));
    expect(page.formulario!.pozo()).toBe(page.pozo());
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
    expect(page.tecnicos().sello_sanitario_constructivo ?? null).toBeNull();
    expect(fixture.nativeElement.querySelector('ion-button.aplicar-estandares').disabled).toBeTrue();
  });
  for (const sello of [null, { desde_m: 1.125, hasta_m: 9.875 }]) {
    it('hidrata el sello histórico sin inventar valores ni dejar cambios: ' + JSON.stringify(sello), async () => {
      const fixture = await cargarEdicionPrueba({}, sello);
      expect(page.tecnicos().sello_sanitario_constructivo).toEqual(sello);
      expect(page.tieneCambiosSinGuardar()).toBeFalse();
      if (sello) {
        page.tecnicos().sello_sanitario_constructivo!.hasta_m = 10;
        expect(page.tieneCambiosSinGuardar()).toBeTrue();
        page.tecnicos().sello_sanitario_constructivo!.hasta_m = 9.875;
        expect(page.tieneCambiosSinGuardar()).toBeFalse();
      }
      fixture.destroy();
    });
  }
  it('PATCH conserva, actualiza y elimina el sello; la recarga canónica deja el formulario limpio', async () => {
    const fixture = await cargarEdicionPrueba({}, { desde_m: 1.125, hasta_m: 9.875 });
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(false);
    const leer = TestBed.inject(PozosEditService).getPozoById as jasmine.Spy;
    for (const cambio of [undefined, { desde_m: 2.25, hasta_m: 8.75 }, null]) {
      if (cambio !== undefined) page.tecnicos.update(datos => ({ ...datos, sello_sanitario_constructivo: cambio }));
      leer.and.resolveTo({ ...page.pozo(), sello_sanitario_constructivo: page.tecnicos().sello_sanitario_constructivo });
      const guardar = page.editar({ pozo: page.pozo(), foto: null, fotoAccion: 'conservar' });
      const req = http.expectOne(`${environment.apiURL}pozos/historicos/18`);
      expect(req.request.body.sello_sanitario_constructivo).toEqual(cambio);
      req.flush({ id_pozo: 18 }); await guardar; fixture.detectChanges(); await fixture.whenStable();
      expect(page.tieneCambiosSinGuardar()).toBeFalse();
      expect(page.tecnicos().sello_sanitario_constructivo).toEqual(cambio === undefined ? { desde_m: 1.125, hasta_m: 9.875 } : cambio);
    }
  });

  it('otra inicia un nuevo histórico con los cuatro estándares después de guardar', async () => {
    const fixture = TestBed.createComponent(HistoricosPage); page = fixture.componentInstance;
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(false);
    await page.ionViewWillEnter(); fixture.detectChanges(); await fixture.whenStable();
    page.numero = 3281;
    Object.assign(page.pozo(), { metodo_sedimentario: 'Personalizado', metodo_rocoso: '', cementacion: null, desarrollo: undefined });
    const guardar = page.guardar();
    http.expectOne(`${environment.apiURL}pozos/epoca-datos`).flush({ epoca: epoch });
    await Promise.resolve();
    http.expectOne(`${environment.apiURL}pozos/historicos`).flush({ id_pozo: 18, numero_perforacion: 3281 });
    await guardar;
    expect(page.resultado()?.id_pozo).toBe(18);
    page.otra(); fixture.detectChanges(); await fixture.whenStable();
    expect(page.pozo()).toEqual({ id_propietario: null, id_perforador: 0, id_sitio: 0, ...DATOS_TECNICOS_ESTANDAR });
    expect(page.formulario!.pozo()).toBe(page.pozo());
    expect(page.resultado()).toBeNull(); expect(page.envio).toBeUndefined();
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
  });

  for (const vacio of [null, undefined, '', '  ']) {
    it(`cargar y reabrir una edición conserva los cuatro campos en ${JSON.stringify(vacio)} sin quedar dirty`, async () => {
      const textos = { metodo_sedimentario: vacio, metodo_rocoso: vacio, cementacion: vacio, desarrollo: vacio };
      const fixture = await cargarEdicionPrueba(textos);
      expect(page.pozo()).toEqual(jasmine.objectContaining(textos));
      expect(page.tieneCambiosSinGuardar()).toBeFalse();
      await page.ionViewWillEnter(); fixture.detectChanges(); await fixture.whenStable();
      expect(page.pozo()).toEqual(jasmine.objectContaining(textos));
      expect(page.tieneCambiosSinGuardar()).toBeFalse();
    });
  }

  it('aplicar estándares manualmente conserva los demás datos del histórico', async () => {
    const fixture = await cargarEdicionPrueba();
    page.pozo().profundidad_final_m = 30; page.pozo().nivel_estatico_m = 0; page.pozo().revestimiento = 'Original';
    const datos = page.tecnicos();
    datos.intervalosLitologicos.push({ idLocal: 'l', dato: { desde_m: 0, hasta_m: 30, material: 'Basalto', id_litologia: 1 } });
    datos.intervalosDiametro.push({ idLocal: 'd', dato: { desde_m: 0, hasta_m: 30, diametro_pulg: 6, material_tuberia: 'Acero' } });
    datos.intervalosFiltro.push({ idLocal: 'f', dato: { desde_m: 10, hasta_m: 20, diametro_pulg: 4, material_tuberia: 'PVC', ranura_mm: 0.75 } });
    datos.nivelesAporte.push({ idLocal: 'a', dato: { profundidad_m: 15 } });
    const antes = structuredClone({ pozo: page.pozo(), sitio: page.sitio(), tecnicos: page.tecnicos() });
    fixture.nativeElement.querySelector('ion-button.aplicar-estandares').click();
    expect(page.pozo()).toEqual({ ...antes.pozo, ...DATOS_TECNICOS_ESTANDAR });
    expect(page.sitio()).toEqual(antes.sitio); expect(page.tecnicos()).toEqual(antes.tecnicos);
  });

  it('aplicar estándares en edición activa el guard; permite editar y borrar los cuatro para enviar NULL', async () => {
    const fixture = await cargarEdicionPrueba();
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
    fixture.nativeElement.querySelector('ion-button.aplicar-estandares').click();
    fixture.detectChanges(); await fixture.whenStable();
    expect(page.pozo()).toEqual(jasmine.objectContaining(DATOS_TECNICOS_ESTANDAR));
    expect(page.tieneCambiosSinGuardar()).toBeTrue();
    const confirmar = spyOn(TestBed.inject(ConfirmarSalidaPerforacionService), 'confirmar').and.resolveTo(false);
    const snapshot = TestBed.inject(Router).routerState.snapshot;
    expect(await TestBed.runInInjectionContext(() => cambiosPerforacionGuard(page, snapshot.root, snapshot, snapshot))).toBeFalse();
    expect(confirmar).toHaveBeenCalledTimes(1);
    for (const campo of Object.keys(DATOS_TECNICOS_ESTANDAR) as CampoTecnicoEstandar[]) {
      const control = fixture.nativeElement.querySelector(`[name="${campo}"]`);
      expect(control.readonly).toBeFalse();
      control.value = `Personalizado ${campo}`;
      control.dispatchEvent(new CustomEvent('ionInput', { bubbles: true }));
      expect(page.pozo()[campo]).toBe(`Personalizado ${campo}`);
    }
    const guardar = page.editar({ pozo: page.pozo(), foto: null, fotoAccion: 'conservar' });
    const req = http.expectOne(`${environment.apiURL}pozos/historicos/18`);
    for (const campo of Object.keys(DATOS_TECNICOS_ESTANDAR)) expect(req.request.body[campo]).toBe(`Personalizado ${campo}`);
    req.flush({}, { status: 500, statusText: 'Error de prueba' }); await guardar;
    for (const campo of Object.keys(DATOS_TECNICOS_ESTANDAR)) {
      const control = fixture.nativeElement.querySelector(`[name="${campo}"]`);
      control.value = '';
      control.dispatchEvent(new CustomEvent('ionInput', { bubbles: true }));
    }
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(false);
    const limpiar = page.editar({ pozo: page.pozo(), foto: null, fotoAccion: 'conservar' });
    const patch = http.expectOne(`${environment.apiURL}pozos/historicos/18`);
    for (const campo of Object.keys(DATOS_TECNICOS_ESTANDAR)) expect(patch.request.body[campo]).toBeNull();
    patch.flush({ id_pozo: 18 }); await limpiar;
  });

  it('cargar y reabrir una edición conserva exactamente los cuatro textos históricos', async () => {
    const textos = { metodo_sedimentario: ' Rotación antigua ', metodo_rocoso: 'Percusión documentada', cementacion: 'Parcial', desarrollo: 'Bombeo' };
    const fixture = await cargarEdicionPrueba(textos);
    await page.ionViewWillEnter(); fixture.detectChanges();
    expect(page.pozo()).toEqual(jasmine.objectContaining(textos));
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
    page.formulario!.aplicarValoresEstandar();
    expect(page.pozo()).toEqual(jasmine.objectContaining(textos));
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
  });

  it('un segundo PATCH usa los IDs recargados y conserva cambios posteriores incluso durante la recarga', async () => {
    const fixture = await cargarEdicionPrueba();
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(false);
    const filtro = { id_intervalo_filtro: 100, desde_m: 0, hasta_m: 10, diametro_pulg: 4, material_tuberia: 'PVC' as const, ranura_mm: 0.5 as const };
    page.tecnicos().intervalosFiltro.push({ idLocal: 'f', dato: { ...filtro } });
    page.inicial.set(structuredClone(page.tecnicos())); page.versionTecnicos.update(v => v + 1);
    fixture.detectChanges(); await fixture.whenStable();
    page.pozo().empresa = 'Enviada';
    let recargar!: (value: unknown) => void;
    const leer = TestBed.inject(PozosEditService).getPozoById as jasmine.Spy;
    const canonico = { ...page.pozo() };
    leer.and.returnValue(new Promise(resolve => { recargar = resolve; }));
    const filtros = TestBed.inject(IntervalosFiltroService).listar as jasmine.Spy;
    filtros.and.resolveTo([{ ...filtro, id_pozo: 18, id_intervalo_filtro: 101 }]);
    const primero = page.editar({ pozo: page.pozo(), foto: null, fotoAccion: 'conservar' });
    const req = http.expectOne(`${environment.apiURL}pozos/historicos/18`);
    expect(req.request.body.intervalos_filtro[0].id_intervalo_filtro).toBe(100);
    page.tecnicos().intervalosFiltro[0].dato.diametro_pulg = 6;
    req.flush({ id_pozo: 18 }); await Promise.resolve();
    page.pozo().empresa = 'Posterior';
    recargar(canonico); await primero; fixture.detectChanges(); await fixture.whenStable();
    expect(page.tecnicos().intervalosFiltro[0].dato.id_intervalo_filtro).toBe(101);
    expect(page.tecnicos().intervalosFiltro[0].dato.diametro_pulg).toBe(6);
    expect(page.pozo().empresa).toBe('Posterior'); expect(page.tieneCambiosSinGuardar()).toBeTrue();
    const hijo = fixture.debugElement.query(By.directive(DatosTecnicosBorradorComponent)).componentInstance as DatosTecnicosBorradorComponent;
    expect(hijo.datos().intervalosFiltro[0].dato.id_intervalo_filtro).toBe(101);
    leer.and.resolveTo({ ...page.pozo() });
    filtros.and.resolveTo([{ ...filtro, diametro_pulg: 6, id_pozo: 18, id_intervalo_filtro: 102 }]);
    const segundo = page.editar({ pozo: page.pozo(), foto: null, fotoAccion: 'conservar' });
    const req2 = http.expectOne(`${environment.apiURL}pozos/historicos/18`);
    expect(req2.request.body.intervalos_filtro[0].id_intervalo_filtro).toBe(101);
    expect(req2.request.body.intervalos_filtro[0].diametro_pulg).toBe(6);
    expect(req2.request.body.empresa).toBe('Posterior');
    req2.flush({ id_pozo: 18 }); await segundo; fixture.detectChanges(); await fixture.whenStable();
    expect(page.tecnicos().intervalosFiltro[0].dato.id_intervalo_filtro).toBe(102);
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
  });

  it('si falla la recarga después del éxito, reintenta sólo GET y protege los cambios pendientes', async () => {
    await cargarEdicionPrueba();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(false);
    page.pozo().empresa = 'Enviada'; const canonico = { ...page.pozo() };
    const leer = TestBed.inject(PozosEditService).getPozoById as jasmine.Spy;
    leer.and.rejectWith(new Error('Sin conexión'));
    const guardar = page.editar({ pozo: page.pozo(), foto: null, fotoAccion: 'conservar' });
    page.pozo().empresa = 'Posterior';
    http.expectOne(`${environment.apiURL}pozos/historicos/18`).flush({ id_pozo: 18 }); await guardar;
    expect(page.recargaPendiente()).toBeTrue(); expect(page.error()).toContain('fue guardada');
    expect(page.tieneCambiosSinGuardar()).toBeTrue(); expect(nav).not.toHaveBeenCalled();
    leer.and.resolveTo(canonico);
    await page.editar({ pozo: page.pozo(), foto: null, fotoAccion: 'conservar' });
    http.expectNone(r => r.method === 'PATCH');
    expect(page.recargaPendiente()).toBeFalse(); expect(page.pozo().empresa).toBe('Posterior');
    expect(page.tieneCambiosSinGuardar()).toBeTrue();
  });

  for (const [accion, existente] of [['reemplazar', false], ['reemplazar', true], ['eliminar', true]] as const) {
    it(`la foto persistida y sus acciones se actualizan desde GET tras ${accion}, foto previa ${existente}, sin salir`, async () => {
      const fixture = await cargarEdicionPrueba();
      spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(false);
      const cargarFoto = spyOn(TestBed.inject(ProtectedResourceService), 'load').and.returnValue(of({ url: 'data:image/png;base64,', revoke: () => {} }));
      const url = '/usuarios/1/pozos/18/foto';
      page.pozo().foto_url = existente ? url : undefined;
      fixture.detectChanges(); await fixture.whenStable();
      const imagenAnterior = fixture.nativeElement.querySelector('img[alt="Fotografía guardada del pozo"]');
      const form = page.formulario!;
      form.propietarioNuevo.nombre = 'Pendiente';
      const foto = accion === 'reemplazar' ? new File(['foto'], 'foto.png', { type: 'image/png' }) : null;
      form.fotoFile = foto; form.eliminarFotoPendiente.set(accion === 'eliminar');
      (TestBed.inject(PozosEditService).getPozoById as jasmine.Spy).and.resolveTo({ ...page.pozo(), foto_url: foto ? url : null });
      const guardar = page.editar({ pozo: page.pozo(), foto, fotoAccion: accion });
      for (let i = 0; i < 100; i++) {
        const requests = http.match(`${environment.apiURL}pozos/historicos/18`);
        if (requests.length) { requests[0].flush({ id_pozo: 18 }); break; }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      await guardar; fixture.detectChanges(); await fixture.whenStable();
      expect(page.pozo().foto_url ?? null).toBe(foto ? url : null);
      expect(form.fotoFile).toBeNull(); expect(form.eliminarFotoPendiente()).toBeFalse();
      const imagen = fixture.nativeElement.querySelector('img[alt="Fotografía guardada del pozo"]');
      if (foto) {
        expect(imagen).not.toBeNull(); expect(imagen).not.toBe(imagenAnterior);
        expect(cargarFoto.calls.count()).toBe(existente ? 2 : 1);
        expect(fixture.nativeElement.textContent).toContain('Eliminar fotografía');
      } else {
        expect(imagen).toBeNull(); expect(form.getFoto()).toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain('Eliminar fotografía');
      }
      expect(form.propietarioNuevo.nombre).toBe('Pendiente'); expect(page.tieneCambiosSinGuardar()).toBeTrue();
    });
  }

  it('no aplica una recarga tardía ni navega después de destruir la página', async () => {
    const fixture = await cargarEdicionPrueba();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    let responder!: (value: unknown) => void;
    (TestBed.inject(PozosEditService).getPozoById as jasmine.Spy).and.returnValue(new Promise(resolve => { responder = resolve; }));
    const antes = page.pozo();
    const guardar = page.editar({ pozo: antes, foto: null, fotoAccion: 'conservar' });
    http.expectOne(`${environment.apiURL}pozos/historicos/18`).flush({ id_pozo: 18 }); await Promise.resolve();
    fixture.destroy(); responder({ ...antes, empresa: 'Remota' }); await guardar;
    expect(page.pozo()).toBe(antes); expect(nav).not.toHaveBeenCalled();
  });

  it('mantiene el formulario y los cambios hechos durante PATCH si se cancela la salida posterior', async () => {
    const fixture = await cargarEdicionPrueba(), form = page.formulario;
    page.pozo().empresa = 'Enviada';
    page.sitio().localidad = 'Enviada'; page.sitio().departamento = 'Salto';
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.callFake(async () => {
      expect(page.tieneCambiosSinGuardar()).toBeTrue();
      return false;
    });
    const guardado = page.editar({ pozo: page.pozo(), foto: null, fotoAccion: 'conservar' });
    const req = http.expectOne(`${environment.apiURL}pozos/historicos/18`);
    (TestBed.inject(PozosEditService).getPozoById as jasmine.Spy).and.resolveTo({
      ...page.pozo(), id_sitio: 9, sitio: { ...page.sitio(), id_sitio: 9 },
    });
    page.pozo().empresa = 'Posterior'; page.sitio().localidad = 'Posterior';
    page.tecnicos().nivelesAporte.push({ idLocal: 'local-1', dato: { profundidad_m: 1 } });
    expect(req.request.body.empresa).toBe('Enviada'); expect(req.request.body.sitio.localidad).toBe('Enviada');
    expect(req.request.body.niveles_aporte).toEqual([]);
    req.flush({ id_pozo: 18 }); await guardado;
    fixture.detectChanges(); await fixture.whenStable();
    expect(nav).toHaveBeenCalledTimes(1); expect(page.cargado()).toBeTrue(); expect(page.formulario).toBe(form);
    expect(page.tieneCambiosSinGuardar()).toBeTrue(); expect(page.pozo().empresa).toBe('Posterior');
    page.pozo().empresa = 'Enviada'; page.sitio().localidad = 'Enviada'; page.tecnicos().nivelesAporte.pop();
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
  });

  for (const accion of ['reemplazar', 'eliminar'] as const) {
    it(`conserva foto/acción ${accion} tras error y queda limpio sólo tras éxito`, async () => {
      await cargarEdicionPrueba();
      const form = page.formulario!;
      const foto = accion === 'reemplazar' ? new File(['foto'], 'foto.png', { type: 'image/png' }) : null;
      form.fotoFile = foto; form.eliminarFotoPendiente.set(accion === 'eliminar');
      const esperarRequest = async () => {
        for (let i = 0; i < 100; i++) {
          const requests = http.match(`${environment.apiURL}pozos/historicos/18`);
          if (requests.length) return requests[0];
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        throw Error('No se recibió PATCH');
      };
      const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(false);
      const fallido = page.editar({ pozo: page.pozo(), foto, fotoAccion: accion });
      const req = await esperarRequest(); expect(req.request.body.foto_accion).toBe(accion);
      if (foto) expect(req.request.body.foto.base64).toBe('Zm90bw==');
      req.flush({}, { status: 500, statusText: 'Error' }); await fallido;
      expect(page.tieneCambiosSinGuardar()).toBeTrue(); expect(form.fotoFile).toBe(foto);
      expect(form.eliminarFotoPendiente()).toBe(accion === 'eliminar'); expect(nav).not.toHaveBeenCalled();
      const guardado = page.editar({ pozo: page.pozo(), foto, fotoAccion: accion });
      (await esperarRequest()).flush({ id_pozo: 18 }); await guardado;
      expect(page.tieneCambiosSinGuardar()).toBeFalse(); expect(form.fotoFile).toBeNull();
      expect(form.eliminarFotoPendiente()).toBeFalse(); expect(page.cargado()).toBeTrue();
    });
  }

  it('un éxito no elimina una foto seleccionada después del envío', async () => {
    await cargarEdicionPrueba();
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(false);
    const guardado = page.editar({ pozo: page.pozo(), foto: null, fotoAccion: 'conservar' });
    const posterior = new File(['posterior'], 'posterior.png', { type: 'image/png' });
    page.formulario!.fotoFile = posterior;
    http.expectOne(`${environment.apiURL}pozos/historicos/18`).flush({ id_pozo: 18 }); await guardado;
    expect(page.formulario!.fotoFile).toBe(posterior); expect(page.tieneCambiosSinGuardar()).toBeTrue();
  });

  it('el propietario es protegido como único cambio y su éxito no limpia cambios posteriores', async () => {
    const fixture = await cargarEdicionPrueba();
    const form = page.formulario!, service = TestBed.inject(PropietariosOperativosService);
    form.propietarioNuevo.nombre = 'Ana'; expect(page.tieneCambiosSinGuardar()).toBeTrue();
    form.propietarioNuevo.nombre = ' \t '; expect(page.tieneCambiosSinGuardar()).toBeFalse();
    form.propietarioNuevo.nombre = 'Ana';
    const crear = spyOn(service, 'crear').and.rejectWith(new Error('fallo'));
    await page.crearPropietario(form.propietarioNuevo); expect(form.tieneCambiosPropietario()).toBeTrue();
    crear.and.resolveTo({ id_usuario: 1, nombre: 'Ana', roles: ['propietario'] });
    await page.crearPropietario(form.propietarioNuevo); expect(form.tieneCambiosPropietario()).toBeFalse();
    fixture.detectChanges();
    form.propietarioSeleccionadoDatos.set({ id_usuario: 1, nombre: 'Ana', roles: ['propietario'] });
    form.abrirEditorPropietario();
    form.propietarioEdicion()!.body.telefono = '123';
    let responder!: (value: never) => void;
    const editar = spyOn(service, 'actualizar').and.returnValue(new Promise(resolve => { responder = resolve; }));
    const actualizacion = page.actualizarPropietario({ id: 1, body: form.propietarioEdicion()!.body });
    form.propietarioEdicion()!.body.telefono = '456';
    expect(editar.calls.mostRecent().args[1].telefono).toBe('123');
    responder({ id_usuario: 1, nombre: 'Ana', telefono: '123' } as never); await actualizacion;
    expect(form.tieneCambiosPropietario()).toBeTrue();
    form.propietarioEdicion()!.body.telefono = '123'; expect(form.tieneCambiosPropietario()).toBeFalse();
  });

  it('whitespace-only en campos históricos no produce cambios y no muta texto no vacío', async () => {
    await cargarEdicionPrueba();
    page.pozo().empresa = ' \t\n '; page.sitio().padron = ' ';
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
    page.pozo().empresa = ' Texto '; expect(page.tieneCambiosSinGuardar()).toBeTrue();
    expect(page.pozo().empresa).toBe(' Texto ');
  });

  for (const conCambios of [false, true]) {
    it(`Atrás cierra el selector real y conserva la edición histórica ${conCambios ? 'con' : 'sin'} cambios`, async () => {
      spyOn(window, 'matchMedia').and.returnValue(Object.assign(new EventTarget(), { matches: true }) as MediaQueryList);
      spyOn(TestBed.inject(PozosEditService), 'getPozoById').and.resolveTo({
        id_pozo: 18, numero_perforacion: 3281, origen: 'historico', id_sitio: null,
        id_propietario: null, id_perforador: null, fecha_creado: '2026-10-06', profundidad_final_m: 20,
      });
      spyOn(TestBed.inject(IntervaloLitologicoListService), 'getIntervalosLitologicos').and.resolveTo([
        { id_intervalo_litologico: 2, id_pozo: 18, desde_m: 10, hasta_m: 20, material: 'Basalto', id_litologia: 1 },
        { id_intervalo_litologico: 1, id_pozo: 18, desde_m: 0, hasta_m: 10, material: 'Basalto', id_litologia: 1 },
      ]);
      spyOn(TestBed.inject(IntervaloDiametroListService), 'getIntervalosDiametros').and.resolveTo([]);
      spyOn(TestBed.inject(IntervalosFiltroService), 'listar').and.resolveTo([]);
      spyOn(TestBed.inject(AporteListService), 'getNivelesAporte').and.resolveTo([]);
      spyOn(TestBed.inject(LitologiasService), 'listar').and.resolveTo([
        { id_litologia: 1, codigo: 'basalto', nombre: 'Basalto', familia: 'basalto', color: '#555555', patron: 'basalt', activo: true, orden: 1 },
      ]);
      const confirmar = spyOn(TestBed.inject(ConfirmarSalidaPerforacionService), 'confirmar').and.resolveTo(false);
      const fixture = TestBed.createComponent(HistoricosPage);
      fixture.componentRef.setInput('id_pozo', '18'); page = fixture.componentInstance;
      await page.ionViewWillEnter(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      // Ordenar las filas cargadas no constituye una edición del usuario.
      expect(page.tieneCambiosSinGuardar()).toBeFalse();
      if (conCambios) page.tecnicos().intervalosLitologicos[0].dato.hasta_m = 9;
      const datosAntes = JSON.stringify({ pozo: page.pozo(), sitio: page.sitio(), tecnicos: page.tecnicos() });
      const formularioAntes = page.formulario;
      const selector = fixture.debugElement.query(By.directive(SelectorLitologiaComponent)).componentInstance as SelectorLitologiaComponent;
      selector.abrirMovil(); selector.buscar('bas');
      const navegar = jasmine.createSpy('navegar');
      const handlers = [{ prioridad: 0, handler: navegar as () => void }];
      document.dispatchEvent(new CustomEvent('ionBackButton', { detail: {
        register: (prioridad: number, handler: () => void) => handlers.push({ prioridad, handler }),
      } }));
      handlers.sort((a, b) => b.prioridad - a.prioridad)[0].handler();
      fixture.detectChanges(); await fixture.whenStable();
      expect(selector.abierto()).toBeFalse();
      expect(navegar).not.toHaveBeenCalled();
      expect(confirmar).not.toHaveBeenCalled();
      expect(page.formulario).toBe(formularioAntes);
      expect(JSON.stringify({ pozo: page.pozo(), sitio: page.sitio(), tecnicos: page.tecnicos() })).toBe(datosAntes);
      expect(page.tieneCambiosSinGuardar()).toBe(conCambios);
      const snapshot = TestBed.inject(Router).routerState.snapshot;
      const salir = () => TestBed.runInInjectionContext(() => cambiosPerforacionGuard(page, snapshot.root, snapshot, snapshot));
      expect(await salir()).toBe(!conCambios);
      expect(confirmar.calls.count()).toBe(conCambios ? 1 : 0);
      expect(JSON.stringify({ pozo: page.pozo(), sitio: page.sitio(), tecnicos: page.tecnicos() })).toBe(datosAntes);
      if (conCambios) {
        confirmar.and.resolveTo(true);
        expect(await salir()).toBeTrue();
      }
      confirmar.calls.reset();
      selector.abrirMovil();
      expect(await TestBed.runInInjectionContext(() => cambiosPerforacionGuard(page, snapshot.root, snapshot,
        { ...snapshot, root: snapshot.root, url: '/login?redirectTo=%2Fpozo' }))).toBeTrue();
      expect(selector.abierto()).toBeFalse();
      expect(confirmar).not.toHaveBeenCalled();
    });
  }

  it('rechaza >=3282 y no envía solicitud',async()=>{
    page.numero=3282;await page.guardar();expect(page.error()).toContain('3281');http.expectNone(`${environment.apiURL}pozos/historicos`);
  });
  it('envía estándares y omite otros datos desconocidos; recarga y reintento mantienen UUID, época y payload',async()=>{
    page.numero=3281;const save=page.guardar();
    http.expectOne(`${environment.apiURL}pozos/epoca-datos`).flush({epoca:epoch});
    await new Promise(r=>setTimeout(r,0));
    const req=http.expectOne(`${environment.apiURL}pozos/historicos`);
    expect(req.request.body).toEqual({numero_perforacion:3281,...DATOS_TECNICOS_ESTANDAR});
    const key=req.request.headers.get('Idempotency-Key');
    req.error(new ProgressEvent('network'));await save;
    page=TestBed.createComponent(HistoricosPage).componentInstance;await page.ionViewWillEnter();
    const retry=page.guardar();const again=http.expectOne(`${environment.apiURL}pozos/historicos`);
    expect(again.request.headers.get('Idempotency-Key')).toBe(key);expect(again.request.headers.get('X-Epoca-Datos')).toBe(epoch);
    expect(again.request.body).toEqual({numero_perforacion:3281,...DATOS_TECNICOS_ESTANDAR});
    again.flush({id_pozo:40,numero_perforacion:3281});await retry;expect(page.resultado()?.id_pozo).toBe(40);
    page.otra();expect(sessionStorage.getItem(storage)).toBeNull();
  });
  it('una solicitud antigua rechazada no obtiene otra época ni se reenvía',async()=>{
    sessionStorage.setItem(storage,JSON.stringify({actor:1,clave:crypto.randomUUID(),epoca:epoch,body:{numero_perforacion:3281}}));
    await page.ionViewWillEnter();const save=page.guardar();
    http.expectOne(`${environment.apiURL}pozos/historicos`).flush({code:'EPOCA_DATOS_RETIRADA',message:'Etapa retirada'},{status:410,statusText:'Gone'});
    await save;expect(page.retirada()).toBeTrue();await page.guardar();http.expectNone(`${environment.apiURL}pozos/epoca-datos`);
  });
  it('un número ocupado permite descartar explícitamente el intento; no recicla payload ni época',async()=>{
    sessionStorage.setItem(storage,JSON.stringify({actor:1,clave:crypto.randomUUID(),epoca:epoch,body:{numero_perforacion:3281}}));
    await page.ionViewWillEnter();const save=page.guardar();
    http.expectOne(`${environment.apiURL}pozos/historicos`).flush({code:'HISTORICO_NUMERO_OCUPADO',message:'Reservado'},{status:409,statusText:'Conflict'});
    await save;expect(page.envio?.rechazada).toBeTrue();
    page.otra();expect(page.envio).toBeUndefined();expect(page.numero).toBeNull();expect(page.retirada()).toBeFalse();
    http.expectNone(`${environment.apiURL}pozos/epoca-datos`);
  });
  it('abre un P-3281 parcial existente y lo completa mediante PATCH sin campos inmutables',async()=>{
    const fixture=TestBed.createComponent(HistoricosPage);fixture.componentRef.setInput('id_pozo','18');page=fixture.componentInstance;
    spyOn(TestBed.inject(PozosEditService),'getPozoById').and.resolveTo({id_pozo:18,numero_perforacion:3281,origen:'historico',id_sitio:null,id_propietario:null,id_perforador:null,fecha_creado:'2026-10-06'});
    spyOn(TestBed.inject(IntervaloLitologicoListService),'getIntervalosLitologicos').and.resolveTo([]);
    spyOn(TestBed.inject(IntervaloDiametroListService),'getIntervalosDiametros').and.resolveTo([]);
    spyOn(TestBed.inject(IntervalosFiltroService),'listar').and.resolveTo([]);
    spyOn(TestBed.inject(AporteListService),'getNivelesAporte').and.resolveTo([]);
    const nav=spyOn(TestBed.inject(Router),'navigate').and.resolveTo(true);
    await page.ionViewWillEnter();expect(page.pozo().numero_perforacion).toBe(3281);expect(page.pozo().empresa).toBeUndefined();
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
    page.pozo.update(p=>({...p,id_propietario:2,id_perforador:3,profundidad_final_m:40,nivel_estatico_m:3}));
    page.sitio.set({departamento:'Salto',localidad:'Campo',latitud:'-31',longitud:'-57'});
    expect(page.tieneCambiosSinGuardar()).toBeTrue();
    const save=page.guardar({pozo:page.pozo(),foto:null,fotoAccion:'conservar'});
    const req=http.expectOne(`${environment.apiURL}pozos/historicos/18`);expect(req.request.method).toBe('PATCH');
    expect(req.request.body.id_propietario).toBe(2);expect(req.request.body.id_perforador).toBe(3);expect(req.request.body.foto_accion).toBe('conservar');
    for(const k of ['numero_perforacion','origen','id_pozo','id_sitio','creado_por'])expect(req.request.body[k]).toBeUndefined();
    req.flush({id_pozo:18,numero_perforacion:3281,origen:'historico'});await save;
    expect(nav).toHaveBeenCalledWith(['/pozos-detail',18]);http.expectNone(`${environment.apiURL}pozos/epoca-datos`);
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
  });

  it('protege cambios y foto tras error de edición, y permite revertir al estado cargado', async () => {
    const fixture=TestBed.createComponent(HistoricosPage);fixture.componentRef.setInput('id_pozo','18');page=fixture.componentInstance;
    spyOn(TestBed.inject(PozosEditService),'getPozoById').and.resolveTo({id_pozo:18,numero_perforacion:3281,origen:'historico',id_sitio:null,id_propietario:null,id_perforador:null,fecha_creado:'2026-10-06'});
    spyOn(TestBed.inject(IntervaloLitologicoListService),'getIntervalosLitologicos').and.resolveTo([]);
    spyOn(TestBed.inject(IntervaloDiametroListService),'getIntervalosDiametros').and.resolveTo([]);
    spyOn(TestBed.inject(IntervalosFiltroService),'listar').and.resolveTo([]);
    spyOn(TestBed.inject(AporteListService),'getNivelesAporte').and.resolveTo([]);
    await page.ionViewWillEnter(); fixture.detectChanges(); await fixture.whenStable();
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
    page.pozo().empresa='Cambio';
    const save=page.editar({pozo:page.pozo(),foto:null,fotoAccion:'conservar'});
    http.expectOne(`${environment.apiURL}pozos/historicos/18`).flush({}, {status:500,statusText:'Error'});
    await save;
    expect(page.pozo().empresa).toBe('Cambio');
    expect(page.tieneCambiosSinGuardar()).toBeTrue();
    page.pozo().empresa=''; expect(page.tieneCambiosSinGuardar()).toBeFalse();
    page.sitio().padron='123'; expect(page.tieneCambiosSinGuardar()).toBeTrue();
    page.sitio().padron=''; expect(page.tieneCambiosSinGuardar()).toBeFalse();
    page.tecnicos().nivelesAporte.push({idLocal:'local-1',dato:{profundidad_m:12}});
    expect(page.tieneCambiosSinGuardar()).toBeTrue();
    page.tecnicos().nivelesAporte.pop(); expect(page.tieneCambiosSinGuardar()).toBeFalse();
    const form=page.formulario as PozosFormComponent;
    form.fotoFile=new File(['foto'],'foto.jpg'); expect(page.tieneCambiosSinGuardar()).toBeTrue();
    form.cancelarCambioFoto(); expect(page.tieneCambiosSinGuardar()).toBeFalse();
    form.solicitarEliminarFotoPersistida(); expect(page.tieneCambiosSinGuardar()).toBeTrue();
    spyOn(TestBed.inject(Router),'navigate').and.resolveTo(true);
    const saved=page.editar({pozo:page.pozo(),foto:null,fotoAccion:'eliminar'});
    http.expectOne(`${environment.apiURL}pozos/historicos/18`).flush({id_pozo:18}); await saved;
    expect(page.tieneCambiosSinGuardar()).toBeFalse();
  });
  it('conserva foto en IndexedDB y reintenta después de recargar con misma clave y payload',async()=>{
    const waitRequest=async(url:string)=>{for(let i=0;i<100;i++){const requests=http.match(url);if(requests.length)return requests[0];await new Promise(r=>setTimeout(r,5));}throw Error('Solicitud no recibida: '+url);};
    page.numero=3279;const foto=new File([new Uint8Array([1,2,3])],'foto.png',{type:'image/png'});
    const save=page.guardar({pozo:page.pozo(),foto,fotoAccion:'reemplazar'});
    (await waitRequest(`${environment.apiURL}pozos/epoca-datos`)).flush({epoca:epoch});
    const req=await waitRequest(`${environment.apiURL}pozos/historicos`);const body=req.request.body,key=req.request.headers.get('Idempotency-Key');
    expect(body.foto.base64).toBe('AQID');expect(JSON.parse(sessionStorage.getItem(storage)!).body.foto).toBeUndefined();
    req.error(new ProgressEvent('network'));await save;
    page=TestBed.createComponent(HistoricosPage).componentInstance;await page.ionViewWillEnter();
    const retry=page.guardar();const again=await waitRequest(`${environment.apiURL}pozos/historicos`);
    expect(again.request.body).toEqual(body);expect(again.request.headers.get('Idempotency-Key')).toBe(key);
    again.flush({id_pozo:19,numero_perforacion:3279});await retry;
  });
});
