import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { PozosFormComponent } from '../../components/pozos-form/pozos-form.component';
import { DatosTecnicosBorradorComponent } from '../../components/datos-tecnicos-borrador/datos-tecnicos-borrador.component';
import { FotoComponent } from '../../../fotos/components/foto/foto.component';
import { environment } from '../../../../../environments/environment';
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
  it('después del éxito dos nuevos intentos sólo navegan al ID creado y nunca repiten el POST', async () => {
    component.nuevoPozo().id_propietario = 1;
    component.nuevoPozo().empresa = 'Enviada';
    const nav = spyOn(component.router, 'navigate').and.resolveTo(false);
    const http = TestBed.inject(HttpTestingController);
    const primero = component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
    const req = http.expectOne(r => r.method === 'POST');
    // Defensa adicional ante una mutación tardía, aun con la UI bloqueada.
    component.nuevoPozo().empresa = 'Posterior';
    req.flush({ pozo: { id_pozo: 44, numero_perforacion: 3282 } }); await primero;
    expect(component.creado()).toEqual({ id: 44, numero: 3282 });
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
    for (let i = 0; i < 2; i++) await component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
    http.expectNone(r => r.method === 'POST'); http.verify();
    expect(nav.calls.allArgs()).toEqual(Array(3).fill([['/pozos-detail', 44], { replaceUrl: true }]));
    expect(component.nuevoPozo().empresa).toBe('Posterior');
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
  });

  it('bloquea campos Ionic, datos técnicos y todo el formulario durante el alta; el error permite reintentar', async () => {
    component.catalogos.set({ propietarios: [], perforadores: [] });
    fixture.detectChanges(); await fixture.whenStable();
    const form = component.formulario!;
    component.nuevoPozo().empresa = 'Conservar';
    const tecnicos = fixture.debugElement.query(By.directive(DatosTecnicosBorradorComponent)).componentInstance as DatosTecnicosBorradorComponent;
    tecnicos.agregarAporte(); fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const guardar = component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
    fixture.detectChanges(); await fixture.whenStable();
    const wrapper = fixture.nativeElement.querySelector('app-pozos-form').parentElement as HTMLElement;
    expect(wrapper.inert).toBeTrue();
    for (const control of fixture.nativeElement.querySelectorAll('app-pozos-form ion-input, app-pozos-form ion-textarea, app-pozos-form ion-select')) expect(control.disabled).toBeTrue();
    const entradasTecnicas = fixture.nativeElement.querySelectorAll('.tecnicos input');
    expect(entradasTecnicas.length).toBeGreaterThan(0);
    for (const control of entradasTecnicas) expect(control.disabled).toBeTrue();
    http.expectOne(r => r.method === 'POST').flush({}, { status: 500, statusText: 'Error' });
    await guardar; fixture.detectChanges(); await fixture.whenStable();
    expect(wrapper.inert).toBeFalse(); expect(component.creado()).toBeNull();
    expect(fixture.nativeElement.querySelector('ion-input[name="empresa"]').disabled).toBeFalse();
    expect(form.pozo().empresa).toBe('Conservar');
    expect(entradasTecnicas[0].disabled).toBeFalse();
    const reintento = component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
    spyOn(component.router, 'navigate').and.resolveTo(false);
    http.expectOne(r => r.method === 'POST').flush({ pozo: { id_pozo: 44 } }); await reintento;
    fixture.detectChanges(); expect(wrapper.inert).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Ver perforación creada'); http.verify();
  });

  it('no inicia el alta con captura pendiente o un subformulario de propietario sin guardar', async () => {
    component.catalogos.set({ propietarios: [], perforadores: [] }); fixture.detectChanges();
    const form = component.formulario!;
    const crear = spyOn(component.createService, 'createPozoCompleto');
    form.capturandoUbicacion.set(true);
    await component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
    expect(component.errorMessage()).toContain('captura');
    form.capturandoUbicacion.set(false);
    const foto = fixture.debugElement.query(By.directive(FotoComponent)).componentInstance as FotoComponent;
    foto.procesando.set(true);
    await component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
    expect(component.errorMessage()).toContain('captura');
    foto.procesando.set(false); form.propietarioNuevo.nombre = 'Pendiente';
    await component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
    expect(component.errorMessage()).toContain('propietario');
    expect(form.propietarioNuevo.nombre).toBe('Pendiente'); expect(crear).not.toHaveBeenCalled();
  });

  it('una navegación fallida después de confirmar el alta no habilita otro POST', async () => {
    const crear = spyOn(component.createService, 'createPozoCompleto').and.resolveTo({ pozo: { id_pozo: 44 } } as never);
    const nav = spyOn(component.router, 'navigate').and.rejectWith(new Error('Navegación fallida'));
    await component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
    expect(component.creado()?.id).toBe(44);
    nav.and.resolveTo(true);
    await component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
    expect(crear).toHaveBeenCalledTimes(1); expect(nav).toHaveBeenCalledWith(['/pozos-detail', 44], { replaceUrl: true });
  });
  it('perforador toma GPS y crea con sitio_nuevo sin usar APIs standalone de Sitios', async () => {
    spyOn(component.authService, 'tieneRol').and.callFake(rol => rol === 'perforador');
    spyOn(component.authService, 'userId').and.returnValue(7);
    spyOn(component.authService, 'isNative').and.returnValue(false);
    spyOn(component.candidatosService, 'obtener').and.resolveTo({ propietarios: [], perforadores: [{ id_usuario: 7, nombre: 'Perforador', roles: ['perforador'] }] });
    spyOn(component.router, 'navigate').and.resolveTo(true);
    await component.ionViewWillEnter(); fixture.detectChanges(); await fixture.whenStable();
    expect(component.tieneCambiosSinGuardar()).toBeFalse();
    const form = fixture.debugElement.query(By.directive(PozosFormComponent)).componentInstance as PozosFormComponent;
    component.nuevoPozo().propietario_provisional = 'Cliente'; component.sitioNuevo().departamento = 'Salto';
    spyOn(navigator.geolocation, 'getCurrentPosition').and.callFake(ok => ok({ coords: { latitude: -31, longitude: -57, accuracy: 5 } } as GeolocationPosition));
    await form.tomarUbicacionNueva();
    expect(component.sitioNuevo()).toEqual(jasmine.objectContaining({ latitud: '-31.000000', longitud: '-57.000000' }));
    form.handlePozo();
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne(`${environment.apiURL}usuarios/7/pozos/completo`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.sitio_nuevo).toEqual(component.sitioNuevo());
    expect(request.request.body.pozo.id_perforador).toBe(7);
    request.flush({ pozo: { id_pozo: 44 } });
    await fixture.whenStable(); http.verify();
    expect(component.tieneCambiosSinGuardar()).toBeFalse();
  });

  it('inicia pozos nuevos con los cuatro datos técnicos estándar', () => {
    expect(component.nuevoPozo()).toEqual(jasmine.objectContaining({
      desarrollo: 'Fue realizado el desarrollo con aire comprimido.',
      cementacion: 'Es el espacio anular entre el tubo de protección sanitario y el revestimiento que fue cementado.',
      metodo_sedimentario: 'Rotativa.',
      metodo_rocoso: 'Rotoneumatica.',
    }));
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
    expect(navegar).toHaveBeenCalledWith(['/pozos-detail', 44], { replaceUrl: true });
    expect(component.tieneCambiosSinGuardar()).toBeFalse();
    component.nuevoPozo().empresa = 'Cambio posterior';
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
  });

  it('un error conserva los datos técnicos preparados', async () => {
    component.nuevoPozo.set({ id_propietario: 1, id_sitio: 2, id_perforador: 3, profundidad_final_m: 20 });
    const borrador = { intervalosLitologicos: [{ idLocal: 'local-1', dato: { desde_m: 0, hasta_m: 10, material: 'Arena', id_litologia: 1 } }], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] };
    component.datosTecnicos.set(borrador);
    spyOn(component.createService, 'createPozoCompleto').and.rejectWith(new Error('fallo controlado'));
    await component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
    expect(component.errorMessage()).toContain('fallo controlado');
    expect(component.datosTecnicos()).toEqual(borrador);
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
  });

  it('detecta cambios reales de campos, sitio y filas, y permite revertirlos', () => {
    expect(component.tieneCambiosSinGuardar()).toBeFalse();
    component.nuevoPozo().empresa = 'Empresa';
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
    component.nuevoPozo().empresa = '';
    expect(component.tieneCambiosSinGuardar()).toBeFalse();
    component.sitioNuevo().localidad = 'Salto';
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
    component.sitioNuevo().localidad = '';
    component.datosTecnicos().nivelesAporte.push({ idLocal: 'local-1', dato: { profundidad_m: 10 } });
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
    component.datosTecnicos().nivelesAporte.pop();
    expect(component.tieneCambiosSinGuardar()).toBeFalse();
  });

  it('protege una foto pendiente y queda limpio al quitarla o guardarla', async () => {
    component.catalogos.set({ propietarios: [], perforadores: [] }); fixture.detectChanges();
    const form = component.formulario!;
    form.fotoFile = new File(['foto'], 'foto.jpg');
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
    form.cancelarCambioFoto(); expect(component.tieneCambiosSinGuardar()).toBeFalse();
    form.fotoFile = new File(['foto'], 'foto.jpg');
    spyOn(component.createService, 'createPozoCompleto').and.resolveTo({ pozo: { id_pozo: 44 } } as never);
    spyOn(component.router, 'navigate').and.resolveTo(true);
    await component.guardarPozo({ pozo: component.nuevoPozo(), foto: form.fotoFile });
    expect(component.tieneCambiosSinGuardar()).toBeFalse();
  });

  for (const falla of [false, true]) {
    it(`editar durante el request pendiente conserva cambios posteriores al ${falla ? 'fallar' : 'guardar'}`, async () => {
      component.nuevoPozo().id_propietario = 1;
      component.nuevoPozo().empresa = 'Enviada';
      component.sitioNuevo().localidad = 'Enviada';
      component.datosTecnicos().nivelesAporte.push({ idLocal: 'local-1', dato: { profundidad_m: 1 } });
      const nav = spyOn(component.router, 'navigate').and.callFake(async () => {
        expect(component.tieneCambiosSinGuardar()).toBeTrue();
        return false;
      });
      const guardado = component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
      const http = TestBed.inject(HttpTestingController);
      const req = http.expectOne(r => r.url.endsWith('/pozos/completo'));
      component.nuevoPozo().empresa = 'Posterior';
      component.sitioNuevo().localidad = 'Posterior';
      component.datosTecnicos().nivelesAporte[0].dato.profundidad_m = 2;
      expect(req.request.body.pozo.empresa).toBe('Enviada');
      expect(req.request.body.sitio_nuevo.localidad).toBe('Enviada');
      expect(req.request.body.niveles_aporte[0].profundidad_m).toBe(1);
      if (falla) req.flush({}, { status: 500, statusText: 'Error' });
      else req.flush({ pozo: { id_pozo: 44 } });
      await guardado;
      expect(component.tieneCambiosSinGuardar()).toBeTrue();
      expect(component.nuevoPozo().empresa).toBe('Posterior');
      expect(component.disabled()).toBeFalse();
      expect(nav.calls.count()).toBe(falla ? 0 : 1);
      component.nuevoPozo().empresa = 'Enviada'; component.sitioNuevo().localidad = 'Enviada';
      component.datosTecnicos().nivelesAporte[0].dato.profundidad_m = 1;
      expect(component.tieneCambiosSinGuardar()).toBe(falla);
      http.verify();
    });
  }

  it('el éxito sólo reconoce la foto enviada y un fallo conserva la foto pendiente', async () => {
    component.catalogos.set({ propietarios: [], perforadores: [] }); fixture.detectChanges();
    const form = component.formulario!;
    const enviada = new File(['foto'], 'enviada.png', { type: 'image/png' });
    const posterior = new File(['otra'], 'posterior.png', { type: 'image/png' });
    let resolver!: (value: never) => void;
    spyOn(component.createService, 'createPozoCompleto').and.returnValue(new Promise(resolve => { resolver = resolve; }));
    spyOn(component.router, 'navigate').and.resolveTo(false);
    form.fotoFile = enviada;
    const guardado = component.guardarPozo({ pozo: component.nuevoPozo(), foto: enviada });
    form.fotoFile = posterior;
    resolver({ pozo: { id_pozo: 44 } } as never); await guardado;
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
    form.fotoFile = enviada; expect(component.tieneCambiosSinGuardar()).toBeFalse();
    form.fotoFile = posterior;
    (component.createService.createPozoCompleto as jasmine.Spy).and.rejectWith(new Error('fallo'));
    await component.guardarPozo({ pozo: component.nuevoPozo(), foto: posterior });
    expect(form.fotoFile).toBe(posterior); expect(component.tieneCambiosSinGuardar()).toBeTrue();
  });

  for (const destruir of [false, true]) {
    it(`un éxito tardío no navega tras ${destruir ? 'destruir la página' : 'redirigir a login'}`, async () => {
      let resolver!: (value: never) => void;
      spyOn(component.createService, 'createPozoCompleto').and.returnValue(new Promise(resolve => { resolver = resolve; }));
      const nav = spyOn(component.router, 'navigate').and.resolveTo(true);
      const guardado = component.guardarPozo({ pozo: component.nuevoPozo(), foto: null });
      if (destruir) fixture.destroy();
      else spyOnProperty(component.router, 'url', 'get').and.returnValue('/login');
      resolver({ pozo: { id_pozo: 44 } } as never); await guardado;
      expect(nav).not.toHaveBeenCalled();
    });
  }

  it('propietario nuevo como único cambio: reversión, error y éxito actualizan sólo su base persistida', async () => {
    spyOn(component.authService, 'tieneRol').and.returnValue(true);
    component.catalogos.set({ propietarios: [], perforadores: [] }); fixture.detectChanges();
    const form = component.formulario!;
    form.propietarioNuevo.nombre = 'Ana'; expect(component.tieneCambiosSinGuardar()).toBeTrue();
    form.propietarioNuevo.nombre = ' \t '; expect(component.tieneCambiosSinGuardar()).toBeFalse();
    form.propietarioNuevo.nombre = 'Ana';
    const crear = spyOn(component.propietariosOperativos, 'crear').and.rejectWith(new Error('fallo'));
    await component.crearPropietario(form.propietarioNuevo);
    expect(form.tieneCambiosPropietario()).toBeTrue();
    crear.and.resolveTo({ id_usuario: 12, nombre: 'Ana', roles: ['propietario'] });
    await component.crearPropietario(form.propietarioNuevo);
    expect(form.tieneCambiosPropietario()).toBeFalse();
    // La nueva vinculación con la perforación todavía no se guardó.
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
  });

  it('edición del propietario como único cambio queda limpia sólo después de éxito', async () => {
    const persona = { id_usuario: 1, nombre: 'Ana', telefono: '123', roles: ['propietario'] };
    component.nuevoPozo().id_propietario = 1;
    spyOn(component.candidatosService, 'obtener').and.resolveTo({ propietarios: [persona], perforadores: [] });
    await component.cargarCatalogos(); fixture.detectChanges();
    const form = component.formulario!; form.abrirEditorPropietario();
    expect(component.tieneCambiosSinGuardar()).toBeFalse();
    form.propietarioEdicion()!.body.telefono = '456'; expect(component.tieneCambiosSinGuardar()).toBeTrue();
    form.propietarioEdicion()!.body.telefono = '123'; expect(component.tieneCambiosSinGuardar()).toBeFalse();
    form.propietarioEdicion()!.body.telefono = '456';
    const editar = spyOn(component.propietariosOperativos, 'actualizar').and.rejectWith(new Error('fallo'));
    await component.actualizarPropietario({ id: 1, body: form.propietarioEdicion()!.body });
    expect(component.tieneCambiosSinGuardar()).toBeTrue();
    editar.and.resolveTo({ ...persona, telefono: '456' } as never);
    await component.actualizarPropietario({ id: 1, body: form.propietarioEdicion()!.body });
    expect(component.tieneCambiosSinGuardar()).toBeFalse();
  });
});
