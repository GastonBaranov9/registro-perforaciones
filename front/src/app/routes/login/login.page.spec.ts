import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AuthService } from '../../shared/services/auth-service/auth.service';
import { CAPACITOR_RUNTIME } from '../../core/native/native-plugin.tokens';
import { NativeBackendConfigService } from '../../core/native/native-backend-config.service';
import { NativeMetadataService } from '../../core/native/native-metadata.service';
import { NativeInstallationStorage, NativeLogoutPendingStorage, NativeSecureSessionStorage } from '../../core/native/native-storage.service';
import { environment } from '../../../environments/environment';
import { LoginPage } from './login.page';

for (const platform of ['web', 'android'] as const) {
describe(`LoginPage ${platform} con AuthService real`, () => {
  let component: LoginPage;
  let fixture: ComponentFixture<LoginPage>;
  let http: HttpTestingController;
  let router: Router;
  const loginUrl = platform === 'web' ? environment.apiURL + 'login' : 'https://api.example.test/api/auth/native/login';
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: CAPACITOR_RUNTIME, useValue: { getPlatform: () => platform, isNativePlatform: () => platform !== 'web' } },
        { provide: NativeBackendConfigService, useValue: {
          origin: () => new URL('https://api.example.test'),
          nativeAuthUrl: (path: string) => 'https://api.example.test' + path,
        } },
        { provide: NativeMetadataService, useValue: { current: async () => ({ platform, appBuild: 1, appVersion: '1.0' }) } },
        { provide: NativeInstallationStorage, useValue: { loadExisting: async () => '123e4567-e89b-42d3-a456-426614174000' } },
        { provide: NativeLogoutPendingStorage, useValue: { verifyWritable: async () => undefined, load: async () => null, clear: async () => undefined } },
        { provide: NativeSecureSessionStorage, useValue: { save: async () => undefined } },
      ],
      imports: [LoginPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  async function completarLogin(expectedPassword?: string): Promise<void> {
    await settle();
    const user = { id_usuario: 7, nombre: 'Prueba', roles: [] };
    const request = http.expectOne(loginUrl);
    if (expectedPassword) expect(request.request.body.password).toBe(expectedPassword);
    request.flush(platform === 'web' ? { authenticated: true } : {
      token_type: 'Bearer', session_token: `rspn1_${'A'.repeat(43)}`,
      expires_at: '2030-01-01T00:00:00.000Z', user,
    });
    if (platform === 'web') {
      await settle();
      http.expectOne(loginUrl).flush(user);
    }
  }

  it('401 muestra alerta persistente, habilita Entrar y permite corregir y reintentar', async () => {
    component.credenciales = { email: 'test@example.test', password: 'incorrecta' };
    const intento = component.logIn(component.credenciales.email, component.credenciales.password);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.login-button')).componentInstance.disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Ingresando…');
    await settle();
    http.expectOne(loginUrl).flush({ message: 'detalle técnico privado' }, { status: 401, statusText: 'Unauthorized' });
    await intento;
    fixture.detectChanges();
    const alerta = fixture.nativeElement.querySelector('.login-error[role="alert"]') as HTMLElement;
    expect(alerta.textContent).toBe('Email o contraseña incorrectas');
    expect(alerta.getAttribute('aria-live')).toBe('assertive');
    expect(component.disabled()).toBeFalse();
    expect(fixture.debugElement.query(By.css('.login-button')).componentInstance.disabled).toBeFalse();
    expect(component.credenciales.password).toBe('incorrecta');
    await new Promise<void>((resolve) => setTimeout(resolve, 1100));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.login-error[role="alert"]').textContent).toBe('Email o contraseña incorrectas');
    component.credenciales.password = 'corregida';
    const segundo = component.logIn(component.credenciales.email, component.credenciales.password);
    expect(component.error()).toBe('');
    await completarLogin();
    await segundo;
    expect(router.navigate).toHaveBeenCalledWith(['/home']);
    expect(component.disabled()).toBeFalse();
    expect(component.credenciales.password).toBe('');
  });

  it('limpia el error al modificar las credenciales', () => {
    component.error.set('Email o contraseña incorrectas');
    fixture.detectChanges();
    fixture.debugElement.query(By.css('ion-input[name="password"]')).triggerEventHandler('ngModelChange', 'nueva');
    fixture.detectChanges();
    expect(component.error()).toBe('');
    expect(fixture.nativeElement.querySelector('.login-error[role="alert"]')).toBeNull();
  });

  it('el ojo alterna visibilidad sin perder ngModel ni enviar el login y conserva la contraseña enviada', async () => {
    const password = fixture.debugElement.query(By.css('ion-input[name="password"]'));
    const toggle = fixture.nativeElement.querySelector('.password-toggle') as HTMLElement;
    expect(password.componentInstance.type).toBe('password');
    expect(toggle.getAttribute('aria-label')).toBe('Mostrar contraseña');
    password.triggerEventHandler('ngModelChange', 'clave de prueba');
    fixture.detectChanges();
    toggle.click();
    fixture.detectChanges();
    expect(password.componentInstance.type).toBe('text');
    expect(toggle.getAttribute('aria-label')).toBe('Ocultar contraseña');
    expect(component.credenciales.password).toBe('clave de prueba');
    password.triggerEventHandler('ngModelChange', 'clave editada');
    toggle.click();
    fixture.detectChanges();
    expect(password.componentInstance.type).toBe('password');
    expect(component.credenciales.password).toBe('clave editada');
    http.expectNone(loginUrl);
    component.passwordVisible.set(true);
    const intento = component.logIn('test@example.test', component.credenciales.password);
    await completarLogin('clave editada');
    await intento;
    expect(component.passwordVisible()).toBeFalse();
    expect(component.credenciales.password).toBe('');
    expect(router.navigate).toHaveBeenCalledWith(['/home']);
  });

  it('login correcto conserva redirectTo y evita solicitudes duplicadas', async () => {
    spyOnProperty(TestBed.inject(ActivatedRoute).snapshot, 'queryParamMap', 'get')
      .and.returnValue(convertToParamMap({ redirectTo: '/pozos-list' }));
    const intento = component.logIn('test@example.test', 'correcta');
    await component.logIn('test@example.test', 'correcta');
    await completarLogin();
    await intento;
    expect(router.navigateByUrl).toHaveBeenCalledWith('/pozos-list');
    expect(component.disabled()).toBeFalse();
  });

  it('no expone errores técnicos y siempre restablece el botón', async () => {
    spyOn(TestBed.inject(AuthService), 'logged').and.rejectWith(new Error('SQL backend interno'));
    await component.logIn('test@example.test', 'incorrecta');
    expect(component.error()).toBe('No se pudo iniciar sesión. Intentá nuevamente.');
    expect(component.disabled()).toBeFalse();
  });
});
}
