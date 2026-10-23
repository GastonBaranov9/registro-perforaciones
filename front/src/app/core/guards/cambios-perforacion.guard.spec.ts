import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter, Router, RouteReuseStrategy, withRouterConfig } from '@angular/router';
import { AlertController, IonApp, IonBackButton, IonRouterOutlet, IonicRouteStrategy, NavController, Platform, provideIonicAngular } from '@ionic/angular/standalone';
import { By } from '@angular/platform-browser';
import { routes } from '../../app.routes';
import { cambiosPerforacionGuard, ConfirmarSalidaPerforacionService, DialogosFormularioService } from './cambios-perforacion.guard';

@Component({ template: 'Destino' })
class Destino {}

@Component({ imports: [IonBackButton], template: '<ion-back-button defaultHref="/destino" />' })
class Formulario {
  dato = '';
  tieneCambiosSinGuardar() { return this.dato !== ''; }
}

@Component({ imports: [IonApp, IonRouterOutlet], template: '<ion-app><ion-router-outlet /></ion-app>' })
class Host {}

describe('Salida de perforación con Ionic y Router', () => {
  let fixture: ComponentFixture<Host>;
  let router: Router;
  let form: Formulario;
  let decidir: (value: { role: string }) => void;
  let alerts: { create: jasmine.Spy };
  let transiciones = 0;

  async function esperar(condicion: () => boolean) {
    for (let i = 0; i < 100 && !condicion(); i++) await new Promise(r => setTimeout(r, 10));
    expect(condicion()).toBeTrue();
  }

  beforeEach(async () => {
    decidir = undefined as never;
    alerts = { create: jasmine.createSpy('create').and.callFake(async () => ({
      present: async () => {},
      onDidDismiss: () => new Promise<{ role: string }>(resolve => { decidir = resolve; }),
      dismiss: jasmine.createSpy('dismiss').and.callFake(async () => { decidir?.({ role: 'cancel' }); return true; }),
      remove: jasmine.createSpy('remove'),
    })) };
    TestBed.configureTestingModule({ imports: [Host], providers: [
      provideIonicAngular({ animated: false }), provideLocationMocks(),
      { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
      provideRouter([
        { path: 'destino', component: Destino },
        { path: 'otro-destino', component: Destino },
        ...['login', 'upgrade-required', 'session-unavailable', 'login-extra'].map(path => ({ path, component: Destino })),
        { path: 'formulario', component: Formulario, canDeactivate: [cambiosPerforacionGuard] },
      ], withRouterConfig({ canceledNavigationResolution: 'computed' })),
      { provide: AlertController, useValue: alerts },
    ] });
    fixture = TestBed.createComponent(Host); fixture.detectChanges();
    router = TestBed.inject(Router);
    router.setUpLocationChangeListener();
    const outlet = fixture.debugElement.query(By.directive(IonRouterOutlet)).componentInstance as IonRouterOutlet;
    transiciones = 0;
    outlet.stackWillChange.subscribe(() => transiciones++);
    outlet.stackDidChange.subscribe(() => transiciones--);
    await TestBed.inject(NavController).navigateForward('/destino');
    fixture.detectChanges(); await fixture.whenStable();
    await esperar(() => transiciones === 0);
    await TestBed.inject(NavController).navigateForward('/formulario');
    fixture.detectChanges(); await fixture.whenStable();
    await esperar(() => transiciones === 0);
    await esperar(() => outlet.canGoBack());
    form = outlet.component as unknown as Formulario;
  });

  afterEach(async () => { await esperar(() => transiciones === 0); });

  it('altas, edición histórica e intervalos instalan la protección de salida', () => {
    for (const path of ['pozos-create', 'pozos-historicos', 'pozos-historicos/:id_pozo/editar', 'pozos/:id_pozo/intervalos-litologicos-create', 'pozos/:id_pozo/intervalos-litologicos-edit/:id_intervalo_litologico']) {
      expect(routes.find(route => route.path === path)?.canDeactivate).toContain(cambiosPerforacionGuard);
    }
  });

  for (const destino of ['/login?redirectTo=%2Fpozo', '/upgrade-required#actualizar', '/session-unavailable?reason=offline', '/session-unavailable?reason=logout-pending', '/session-unavailable?reason=client-error']) {
    it(`la salida obligatoria ${destino} cierra todos los diálogos y no pregunta`, async () => {
      form.dato = 'Pendiente';
      const dialogos = TestBed.inject(DialogosFormularioService);
      const cerrarUno = jasmine.createSpy('cerrarUno'), cerrarDos = jasmine.createSpy('cerrarDos');
      dialogos.registrar(cerrarUno); dialogos.registrar(cerrarDos);
      expect(await router.navigateByUrl(destino)).toBeTrue();
      expect(router.url).toBe(destino);
      expect(cerrarUno).toHaveBeenCalledTimes(1); expect(cerrarDos).toHaveBeenCalledTimes(1);
      expect(dialogos.cerrarActivo()).toBeFalse();
      expect(alerts.create).not.toHaveBeenCalled();
    });
  }

  it('no exceptúa rutas que sólo comparten prefijo con login', async () => {
    form.dato = 'Pendiente';
    const salida = router.navigateByUrl('/login-extra');
    await esperar(() => !!decidir); decidir({ role: 'cancel' });
    expect(await salida).toBeFalse();
    expect(router.url).toBe('/formulario');
  });

  it('una redirección obligatoria retira la alerta pendiente sin heredar su decisión', async () => {
    form.dato = 'Pendiente';
    const salida = router.navigateByUrl('/destino');
    await esperar(() => !!decidir);
    const alert = await alerts.create.calls.mostRecent().returnValue;
    expect(await router.navigateByUrl('/login')).toBeTrue();
    expect(await salida).toBeFalse();
    expect(alert.dismiss).toHaveBeenCalled();
    expect(router.url).toBe('/login');
  });

  it('no presenta una alerta cuya creación termina después de la salida obligatoria', async () => {
    let crear!: (alert: unknown) => void;
    alerts.create.and.callFake(() => new Promise(resolve => { crear = resolve; }));
    form.dato = 'Pendiente';
    const salida = router.navigateByUrl('/destino');
    await esperar(() => !!crear);
    expect(await router.navigateByUrl('/session-unavailable')).toBeTrue();
    const alert = { present: jasmine.createSpy('present'), remove: jasmine.createSpy('remove') };
    crear(alert); await fixture.whenStable();
    expect(await salida).toBeFalse();
    expect(alert.present).not.toHaveBeenCalled(); expect(alert.remove).toHaveBeenCalledTimes(1);
  });

  it('dos intentos de navegación concurrentes comparten una sola alerta y conservan datos al cancelar', async () => {
    form.dato = 'Pendiente';
    const primera = router.navigateByUrl('/destino');
    await esperar(() => !!decidir);
    const segunda = router.navigateByUrl('/otro-destino');
    await new Promise(resolve => setTimeout(resolve, 0));
    decidir({ role: 'cancel' });
    expect(await primera).toBeFalse(); expect(await segunda).toBeFalse();
    expect(alerts.create).toHaveBeenCalledTimes(1);
    expect(router.url).toBe('/formulario'); expect(form.dato).toBe('Pendiente');
  });

  it('sin cambios navega sin preguntar', async () => {
    expect(await router.navigateByUrl('/destino')).toBeTrue();
    expect(alerts.create).not.toHaveBeenCalled();
  });

  it('replaceUrl conserva la instancia al cancelar y la retira de Ionic al confirmar, permitiendo un alta nueva', async () => {
    const anterior = form;
    form.dato = 'Cambio posterior';
    const cancelar = router.navigateByUrl('/destino', { replaceUrl: true });
    await esperar(() => !!decidir); decidir({ role: 'cancel' });
    expect(await cancelar).toBeFalse();
    const outlet = fixture.debugElement.query(By.directive(IonRouterOutlet)).componentInstance as IonRouterOutlet;
    expect(outlet.component as unknown).toBe(anterior);
    decidir = undefined as never;
    const confirmar = router.navigateByUrl('/destino', { replaceUrl: true });
    await esperar(() => !!decidir); decidir({ role: 'destructive' });
    expect(await confirmar).toBeTrue();
    fixture.detectChanges(); await fixture.whenStable(); await esperar(() => transiciones === 0);
    await TestBed.inject(NavController).navigateForward('/formulario');
    fixture.detectChanges(); await fixture.whenStable(); await esperar(() => transiciones === 0);
    expect(outlet.component as unknown).not.toBe(anterior);
    expect((outlet.component as unknown as Formulario).dato).toBe('');
  });

  it('cancelar conserva la instancia y los datos; confirmar permite la salida', async () => {
    form.dato = 'Datos intactos';
    const salir = router.navigateByUrl('/destino');
    await esperar(() => !!decidir); decidir({ role: 'cancel' });
    expect(await salir).toBeFalse();
    expect(router.url).toBe('/formulario');
    expect(form.dato).toBe('Datos intactos');
    const outlet = fixture.debugElement.query(By.directive(IonRouterOutlet)).componentInstance as IonRouterOutlet;
    expect(outlet.component as unknown).toBe(form);
    decidir = undefined as never;
    const otraSalida = router.navigateByUrl('/destino');
    await esperar(() => !!decidir);
    decidir({ role: 'destructive' });
    expect(await otraSalida).toBeTrue();
    expect(router.url).toBe('/destino');
  });

  it('la flecha de Ionic cancela sin perder datos ni ejecutar una segunda navegación', async () => {
    form.dato = 'Pendiente';
    fixture.nativeElement.querySelector('ion-back-button').click();
    await esperar(() => !!decidir); decidir({ role: 'cancel' });
    await fixture.whenStable();
    expect(router.url).toBe('/formulario');
    expect(form.dato).toBe('Pendiente');
    expect(alerts.create).toHaveBeenCalledTimes(1);
  });

  it('Atrás Android pasa por el guard de la navegación Ionic', async () => {
    form.dato = 'Pendiente Android';
    const handlers: { priority: number; handler: (next: () => void) => void }[] = [];
    // Entrega del evento a Platform de esta instancia (los listeners globales de
    // otras instancias de TestBed no forman parte de esta navegación).
    TestBed.inject(Platform).backButton.next({
      register: (priority: number, handler: (next: () => void) => void) => handlers.push({ priority, handler }),
    });
    handlers.sort((a, b) => b.priority - a.priority)[0].handler(() => {});
    await esperar(() => !!decidir); decidir({ role: 'cancel' });
    await fixture.whenStable();
    expect(router.url).toBe('/formulario');
    expect(form.dato).toBe('Pendiente Android');
  });

  it('historial atrás cancelado conserva la ruta y permite reintentar', async () => {
    form.dato = 'Pendiente historial';
    TestBed.inject(Location).back();
    await esperar(() => !!decidir); decidir({ role: 'cancel' });
    await fixture.whenStable();
    expect(router.url).toBe('/formulario');
    expect(TestBed.inject(Location).path()).toBe('/formulario');
    expect(form.dato).toBe('Pendiente historial');
    decidir = undefined as never;
    TestBed.inject(Location).back();
    await esperar(() => !!decidir);
    decidir({ role: 'destructive' }); await fixture.whenStable();
    expect(router.url).toBe('/destino');
  });

  it('un modal abierto se cierra antes de preguntar por cambios o navegar', async () => {
    form.dato = 'Pendiente';
    const cerrar = jasmine.createSpy('cerrar');
    const desregistrar = TestBed.inject(DialogosFormularioService).registrar(() => { cerrar(); desregistrar(); });
    expect(await router.navigateByUrl('/destino')).toBeFalse();
    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(alerts.create).not.toHaveBeenCalled();
    expect(router.url).toBe('/formulario');
    expect(form.dato).toBe('Pendiente');
  });

  it('reutiliza la confirmación pendiente y sólo descarta con la acción explícita', async () => {
    const service = TestBed.inject(ConfirmarSalidaPerforacionService);
    const primera = service.confirmar(), segunda = service.confirmar();
    expect(primera).toBe(segunda);
    await esperar(() => !!decidir); decidir({ role: 'backdrop' });
    expect(await primera).toBeFalse();
    expect(alerts.create).toHaveBeenCalledTimes(1);
    expect(alerts.create.calls.mostRecent().args[0].buttons).toEqual([
      { text: 'Seguir editando', role: 'cancel' }, { text: 'Descartar y salir', role: 'destructive' },
    ]);
  });
});
