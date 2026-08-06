import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { PozosFormComponent } from './pozos-form.component';

describe('PozosFormComponent', () => {
  let component: PozosFormComponent;
  let fixture: ComponentFixture<PozosFormComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      imports: [PozosFormComponent, IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(PozosFormComponent);
    fixture.componentRef.setInput('pozo', { id_propietario: 1, id_sitio: 1, id_perforador: 1 });
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('quitar foto antes de guardar solo limpia la selección local', () => {
    component.fotoFile = new File(['foto'], 'foto.jpg', { type: 'image/jpeg' });
    component.fotoBlob = component.fotoFile;
    component.quitarFotoSeleccionada();
    expect(component.fotoFile).toBeNull();
    expect(component.fotoBlob).toBeNull();
  });

  it('aplaza la eliminación persistida hasta guardar la edición', () => {
    component.solicitarEliminarFotoPersistida();
    expect(component.eliminarFotoPendiente()).toBeTrue();
    const emitir = spyOn(component.saved, 'emit');
    component.handlePozo();
    expect(emitir).toHaveBeenCalledWith(jasmine.objectContaining({ fotoAccion: 'eliminar' }));
  });
  it('seleccionar una foto conserva archivo y vista previa para creación o reemplazo', () => {
    const archivo = new File(['foto'], 'pozo.jpg', { type: 'image/jpeg' });
    component.fotoCapturada({ archivo, vistaPrevia: 'data:image/jpeg;base64,/9j/' });
    expect(component.fotoFile).toBe(archivo);
    expect(component.fotoVistaPrevia()).toContain('data:image/jpeg');
    const emitir = spyOn(component.saved, 'emit');
    component.handlePozo();
    expect(emitir).toHaveBeenCalledWith(jasmine.objectContaining({ fotoAccion: 'reemplazar', foto: archivo }));
  });

  it('cancelar reemplazo restaura la decisión de conservar la foto persistida', () => {
    component.eliminarFotoPendiente.set(true);
    component.fotoCapturada({ archivo: new File(['foto'], 'pozo.jpg', { type: 'image/jpeg' }), vistaPrevia: 'data:image/jpeg;base64,/9j/' });
    component.cancelarCambioFoto();
    const emitir = spyOn(component.saved, 'emit');
    component.handlePozo();
    expect(component.fotoFile).toBeNull();
    expect(component.fotoVistaPrevia()).toBeNull();
    expect(emitir).toHaveBeenCalledWith(jasmine.objectContaining({ fotoAccion: 'conservar' }));
  });
});
