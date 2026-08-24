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

  it('retira sello sanitario y pre-filtro del formulario moderno', () => {
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).not.toContain('Sello sanitario');
    expect(texto).not.toContain('Pre-filtro');
    expect(fixture.nativeElement.querySelector('[name="sello_sanitario"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[name="pre_filtro"]')).toBeNull();
  });

  it('mantiene los datos estándar readonly y Editar habilita solo el elegido', () => {
    expect(component.datoTecnicoEditable('desarrollo')).toBeFalse();
    expect(component.datoTecnicoEditable('cementacion')).toBeFalse();
    const desarrollo = fixture.nativeElement.querySelector('ion-textarea[name="desarrollo"]') as HTMLIonTextareaElement;
    expect(desarrollo.readonly).toBeTrue();
    component.editarDatoTecnico('desarrollo'); fixture.detectChanges();
    expect(component.datoTecnicoEditable('desarrollo')).toBeTrue();
    expect(component.datoTecnicoEditable('cementacion')).toBeFalse();
    expect(desarrollo.readonly).toBeFalse();
  });

  it('oculta el alta mientras hay propietario y vuelve a mostrarla al limpiar', () => {
    expect(component.propietarioSeleccionado()).toBeTrue();
    component.limpiarPropietario();
    expect(component.propietarioSeleccionado()).toBeFalse();
    const emitir = spyOn(component.crearPropietario, 'emit');
    component.propietarioNuevo.nombre = 'Operativo';
    component.registrarPropietario();
    expect(emitir).toHaveBeenCalledWith(jasmine.objectContaining({ nombre: 'Operativo', documento_rut: '', observaciones: '' }));
  });

  it('registra formulario completo y ofrece selector controlado de departamento', () => {
    component.limpiarPropietario(); fixture.detectChanges();
    Object.assign(component.propietarioNuevo,{nombre:'Ana Pérez',documento_rut:'1.234.567-8',telefono:'+598 99 123 456',email:'ana@example.test',direccion:'Ruta 3',localidad:'Young',departamento:'Río Negro',observaciones:'Texto simple'});
    const emitir=spyOn(component.crearPropietario,'emit');component.registrarPropietario();
    expect(emitir).toHaveBeenCalledWith(jasmine.objectContaining({nombre:'Ana Pérez',departamento:'Río Negro',observaciones:'Texto simple'}));
    expect(fixture.nativeElement.querySelector('ion-select[name="propietario_nuevo_departamento"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('ion-textarea[name="propietario_nuevo_observaciones"]')).not.toBeNull();
  });

  it('carga NULL como vacío y permite limpiar opcionales al editar', () => {
    component.seleccionarPropietario({id_usuario:1,nombre:'Histórico',documento_rut:null,email:null,roles:['propietario']});
    component.abrirEditorPropietario();
    expect(component.propietarioEdicion()?.documento_rut).toBe('');expect(component.propietarioEdicion()?.email).toBe('');
    component.propietarioEdicion()!.telefono='';
    const emitir=spyOn(component.actualizarPropietario,'emit');component.guardarEditorPropietario();
    expect(emitir).toHaveBeenCalledWith(jasmine.objectContaining({id:1,body:jasmine.objectContaining({telefono:''})}));
  });

  it('padrón viaja con el sitio nuevo sin alterar el borrador', () => {
    const sitio={departamento:'Salto',padron:'001-A',latitud:'-31',longitud:'-57'};
    fixture.componentRef.setInput('sitioNuevo',sitio);const emitir=spyOn(component.saved,'emit');component.handlePozo();
    expect(sitio.padron).toBe('001-A');expect(emitir).toHaveBeenCalled();
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

  it('normaliza DMS del sitio nuevo y emite decimales', () => {
    const sitio={departamento:'Salto',latitud:`31°26'38.1"S`,longitud:`57°59'11.6"W`};
    fixture.componentRef.setInput('sitioNuevo',sitio);
    const emitir=spyOn(component.saved,'emit');component.handlePozo();
    expect(sitio.latitud).toBe('-31.4439167');expect(sitio.longitud).toBe('-57.9865556');expect(emitir).toHaveBeenCalled();
  });
});
