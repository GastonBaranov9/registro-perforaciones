import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AlertController } from '@ionic/angular/standalone';
import { IonicModule } from '@ionic/angular';
import { OfflinePage } from './offline.page';
import { OfflineService } from '../../core/native/offline.service';
import { BorradorLocal } from '../../core/native/offline-repository';
import { DatosTecnicosBorradorComponent } from '../pozos/components/datos-tecnicos-borrador/datos-tecnicos-borrador.component';

describe('OfflinePage edición, foto persistida y eliminación explícita', () => {
  let fixture: ComponentFixture<OfflinePage>, page: OfflinePage, offline: any, alert: any, alerts: any;
  let d: BorradorLocal;
  beforeEach(async () => {
    d = { id: crypto.randomUUID(), usuario: 7, estado: 'pendiente', pozo: { id_propietario: null, propietario_provisional: 'Cliente', id_perforador: 7, id_sitio: 0 },
      sitio: { departamento: '', localidad: '', latitud: '', longitud: '' }, tecnicos: { intervalosLitologicos: [], intervalosDiametro: [], intervalosFiltro: [], nivelesAporte: [] } };
    offline = { auth: { state: () => 'offline-unverified' }, sinRed: signal(true), ocupado: signal(false), editando: signal(false), mensaje: signal(''), borradores: signal([d]),
      owner: jasmine.createSpy().and.resolveTo({ id_usuario: 7, nombre: 'Perforador' }), cargar: jasmine.createSpy().and.resolveTo(),
      fotoUri: jasmine.createSpy().and.resolveTo('https://localhost/_capacitor_file_/data/photo'),
      guardar: jasmine.createSpy().and.resolveTo(), eliminar: jasmine.createSpy().and.resolveTo(), sincronizar: jasmine.createSpy().and.resolveTo() };
    alert = { present: jasmine.createSpy().and.resolveTo(), onDidDismiss: jasmine.createSpy().and.resolveTo({ role: 'cancel' }) };
    alerts = { create: jasmine.createSpy().and.resolveTo(alert) };
    await TestBed.configureTestingModule({ imports: [OfflinePage, IonicModule.forRoot()], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: OfflineService, useValue: offline }, { provide: AlertController, useValue: alerts }] })
      .overrideComponent(DatosTecnicosBorradorComponent, { set: { template: '', providers: [] } }).compileComponents();
    fixture = TestBed.createComponent(OfflinePage); page = fixture.componentInstance; fixture.detectChanges();
  });
  it('Editar espera al render, muestra foto y desplaza/focaliza el encabezado sin recrear el UUID', async () => {
    const scroll = document.createElement('div'); scroll.scrollTop = 200;
    spyOn(page.content!, 'getScrollElement').and.resolveTo(scroll);
    const move = spyOn(page.content!, 'scrollToPoint').and.resolveTo();
    await page.editar(d);
    expect(move).not.toHaveBeenCalled();
    fixture.detectChanges(); await fixture.whenStable();
    expect(page.editando()!.id).toBe(d.id); expect(page.form).toBeDefined();
    expect(page.form!.fotoLocalUri()).toContain('/data/photo'); expect(page.form!.fotoFile).toBeNull();
    expect(move).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(page.inicioFormulario!.nativeElement);
    expect(offline.guardar).not.toHaveBeenCalled();
  });
  it('foto ausente no impide editar otros datos ni elimina su referencia', async () => {
    d.foto = { ruta: 'stored-photo', tipo: 'image/jpeg' }; offline.fotoUri.and.rejectWith(new Error('Missing'));
    await page.editar(d);
    expect(page.editando()!.foto).toEqual(d.foto); expect(page.error()).toContain('No se pudo abrir');
  });
  for (const accion of ['normal', 'incompleto']) {
    it(`Guardar borrador (${accion}) conserva UUID, datos incompletos y foto sin sincronizar`, async () => {
      d.foto = { ruta: 'stored-photo', tipo: 'image/jpeg' };
      await page.editar(d); fixture.detectChanges(); await fixture.whenStable();
      const borrador = page.editando()!;
      const foto = new File(['foto'], 'pendiente.jpg', { type: 'image/jpeg' });
      page.form!.fotoFile = foto;
      const normal = fixture.debugElement.query(By.css('app-pozos-form ion-button[type="submit"]'));
      const alternativa = fixture.debugElement.queryAll(By.css('ion-button'))
        .find(boton => boton.nativeElement.textContent.trim() === 'Guardar borrador incompleto')!;
      expect(normal.nativeElement.textContent.trim()).toBe('Guardar borrador');
      expect(alternativa.nativeElement.textContent.trim()).toBe('Guardar borrador incompleto');
      expect(fixture.nativeElement.querySelector('#ayuda-borrador-incompleto').textContent).toContain('Si faltan campos obligatorios');
      expect(normal.componentInstance.disabled).toBeFalse();
      if (accion === 'normal') {
        fixture.debugElement.query(By.css('app-pozos-form form')).triggerEventHandler('ngSubmit', {});
      } else { alternativa.triggerEventHandler('click', {}); }
      await fixture.whenStable();
      expect(offline.guardar).toHaveBeenCalledOnceWith(borrador, foto);
      expect(borrador.id).toBe(d.id);
      expect(borrador.estado).toBe('pendiente');
      expect(borrador.sitio).toEqual(d.sitio);
      expect(borrador.foto).toEqual(d.foto);
      expect(page.editando()).toBeNull();
      expect(offline.sincronizar).not.toHaveBeenCalled();
    });
  }
  it('fallo de escritura conserva formulario y File para reintentar antes de salir', async () => {
    await page.editar(d); fixture.detectChanges(); await fixture.whenStable();
    const file = new File(['new'], 'new.png', { type: 'image/png' }); page.form!.fotoFile = file;
    offline.guardar.and.rejectWith(new Error('No se guardó la foto'));
    await page.guardar(); expect(page.error()).toContain('No se guardó'); expect(page.editando()!.id).toBe(d.id);
    expect(page.form!.fotoFile).toBe(file); expect(page.editando()!.id).toBe(d.id);
    offline.guardar.and.resolveTo(); await page.guardar(); expect(page.editando()).toBeNull();
  });
  it('salir descarta el editor en memoria para no exponerlo a otra cuenta', async () => {
    await page.editar(d); fixture.detectChanges(); await fixture.whenStable();
    offline.guardar.and.rejectWith(new Error('No se guardó'));
    await page.ionViewWillLeave(); expect(page.editando()).toBeNull(); expect(page.fotoLocalUri()).toBeNull();
  });
  it('Cancelar o cerrar confirmación no elimina; confirmar sí', async () => {
    await page.eliminar(d); expect(offline.eliminar).not.toHaveBeenCalled();
    alert.onDidDismiss.and.resolveTo({ role: 'confirm' }); await page.eliminar(d);
    expect(offline.eliminar).toHaveBeenCalledOnceWith(d.id);
    expect(alerts.create.calls.mostRecent().args[0].header).toBe('Eliminar borrador');
  });
  it('operación incierta no muestra ni ejecuta eliminación; confirmado dice copia local', async () => {
    d.enviado = true; d.estado = 'error'; fixture.detectChanges();
    await page.eliminar(d); expect(alerts.create).not.toHaveBeenCalled(); expect(fixture.nativeElement.textContent).not.toContain('Eliminar borrador');
    d.estado = 'sincronizado'; d.resultado = { pozo: { id_pozo: 40, numero_perforacion: 8500 } } as any; fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Eliminar copia local');
    await page.eliminar(d); expect(alerts.create.calls.mostRecent().args[0].message).toContain('seguirá en el servidor');
  });
});
