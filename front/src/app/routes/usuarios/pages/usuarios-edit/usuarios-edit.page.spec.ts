import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ToastController } from '@ionic/angular';
import { environment } from '../../../../../environments/environment';
import { UsuarioFormComponent } from '../../components/usuario-form/usuario-form.component';

import { UsuariosEditPage } from './usuarios-edit.page';

describe('UsuariosEditPage', () => {
  let component: UsuariosEditPage;
  let fixture: ComponentFixture<UsuariosEditPage>;
  let http: HttpTestingController;
  const roles = [{ id_rol: 3, nombre: 'propietario', descr: 'Propietario' }];
  const usuario = {
    id_usuario: 1, email: 'usuario@example.test', nombre: 'Usuario', activo: true,
    fecha_registro: '2026-01-01', roles,
  };
  const url = environment.apiURL + 'usuarios/1';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [UsuariosEditPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UsuariosEditPage);
    fixture.componentRef.setInput('id_usuario', 1);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    http.expectOne(url).flush(usuario);
    http.expectOne(environment.apiURL + 'roles').flush(roles);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  for (const password of ['', ' nueva-clave ']) {
    it(`envía sólo los datos de cuenta ${password ? 'con contraseña confirmada' : 'sin cambiar la contraseña'} y evita doble envío`, async () => {
      const form = fixture.debugElement.query(By.directive(UsuarioFormComponent)).componentInstance as UsuarioFormComponent;
      form.user().password = password;
      form.passwordConfirmation = password;
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const handleEdit = spyOn(component, 'handleEdit').and.callThrough();
      const submit = fixture.debugElement.query(By.css('form'));
      submit.triggerEventHandler('ngSubmit');
      const envio = handleEdit.calls.first().returnValue;
      fixture.detectChanges();
      const button = fixture.debugElement.query(By.css('ion-button[type="submit"]'));
      expect(button.componentInstance.disabled).toBeTrue();
      expect(button.nativeElement.getAttribute('aria-busy')).toBe('true');
      submit.triggerEventHandler('ngSubmit');
      await component.handleEdit(form.user());
      const request = http.expectOne(url);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({
        email: usuario.email, nombre: usuario.nombre, activo: true, roles,
        ...(password ? { password } : {}),
      });
      request.flush(usuario);
      await envio;
      await fixture.whenStable();
      fixture.detectChanges();
      expect(component.disabled()).toBeFalse();
      expect(button.componentInstance.disabled).toBeFalse();
    });
  }

  it('habilita Guardar nuevamente si falla la petición', async () => {
    const toast = { present: jasmine.createSpy('present').and.resolveTo() };
    spyOn(component.toastController, 'create').and.resolveTo(toast as unknown as Awaited<ReturnType<ToastController['create']>>);
    const intento = component.handleEdit(component.userResource.value()!.usuario);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('ion-button[type="submit"]')).componentInstance.disabled).toBeTrue();
    http.expectOne(url).flush({ message: 'No se pudo guardar' }, { status: 500, statusText: 'Error' });
    await intento;
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('ion-button[type="submit"]')).componentInstance.disabled).toBeFalse();
    expect(toast.present).toHaveBeenCalled();
  });
});
