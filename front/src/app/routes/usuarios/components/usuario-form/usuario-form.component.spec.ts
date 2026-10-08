import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { IonicModule } from '@ionic/angular';

import { UsuarioFormComponent } from './usuario-form.component';

describe('UsuarioFormComponent', () => {
  let component: UsuarioFormComponent;
  let fixture: ComponentFixture<UsuarioFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [UsuarioFormComponent, IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(UsuarioFormComponent);
    fixture.componentRef.setInput('roles', []);
    fixture.componentRef.setInput('passwordRequired', false);
    fixture.componentRef.setInput('user', {
      email: 'usuario@example.test', nombre: 'Usuario', password: '', activo: true, roles: [],
    });
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const submit = () => fixture.debugElement.query(By.css('form')).triggerEventHandler('ngSubmit');
  const saveButton = () => fixture.debugElement.query(By.css('ion-button[type="submit"]')).componentInstance;

  async function escribir(name: string, value: string) {
    fixture.debugElement.query(By.css(`ion-input[name="${name}"]`)).triggerEventHandler('ngModelChange', value);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('permite guardar con contraseña vacía sin exigir confirmación', () => {
    const emit = spyOn(component.saved, 'emit');
    expect(fixture.nativeElement.querySelector('[name="passwordConfirmation"]')).toBeNull();
    expect(saveButton().disabled).toBeFalse();
    submit();
    expect(emit).toHaveBeenCalledOnceWith({
      email: 'usuario@example.test',
      nombre: 'Usuario',
      password: '',
      activo: true,
      roles: [],
    });
  });

  it('exige confirmar una nueva contraseña y permite guardar cuando coincide literalmente', async () => {
    const emit = spyOn(component.saved, 'emit');
    await escribir('password', ' nueva-clave ');
    expect(fixture.nativeElement.textContent).toContain('Confirmar nueva contraseña');
    expect(saveButton().disabled).toBeTrue();
    submit();
    expect(emit).not.toHaveBeenCalled();
    await escribir('passwordConfirmation', ' nueva-clave ');
    expect(saveButton().disabled).toBeFalse();
    submit();
    expect(emit).toHaveBeenCalledOnceWith(component.user());
    expect(Object.keys(emit.calls.mostRecent().args[0])).not.toContain('passwordConfirmation');
  });

  it('bloquea contraseñas distintas y muestra un mensaje claro', async () => {
    const emit = spyOn(component.saved, 'emit');
    await escribir('password', ' nueva-clave ');
    await escribir('passwordConfirmation', 'nueva-clave');
    expect(saveButton().disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Las contraseñas no coinciden.');
    submit();
    expect(emit).not.toHaveBeenCalled();
    await escribir('passwordConfirmation', ' nueva-clave ');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(saveButton().disabled).toBeFalse();
  });

  it('vuelve a conservar la contraseña actual al borrar la nueva aunque quede confirmación', async () => {
    const emit = spyOn(component.saved, 'emit');
    await escribir('password', 'nueva-clave');
    await escribir('passwordConfirmation', 'otra-clave');
    await escribir('password', '');
    expect(fixture.nativeElement.querySelector('[name="passwordConfirmation"]')).toBeNull();
    expect(saveButton().disabled).toBeFalse();
    submit();
    expect(emit.calls.mostRecent().args[0].password).toBe('');
  });

  it('bloquea el botón y el submit mientras se guarda, y permite reintentar al terminar', () => {
    const emit = spyOn(component.saved, 'emit');
    fixture.componentRef.setInput('saving', true);
    fixture.detectChanges();
    expect(saveButton().disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('GUARDANDO…');
    submit();
    expect(emit).not.toHaveBeenCalled();
    fixture.componentRef.setInput('saving', false);
    fixture.detectChanges();
    expect(saveButton().disabled).toBeFalse();
    submit();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('mantiene la contraseña obligatoria al crear una cuenta', async () => {
    fixture.componentRef.setInput('passwordRequired', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(saveButton().disabled).toBeTrue();
    await escribir('password', 'clave-nueva');
    expect(saveButton().disabled).toBeFalse();
  });
});
