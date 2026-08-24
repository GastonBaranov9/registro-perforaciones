import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { PozosFormComponent } from './pozos-form.component';

describe('PozosFormComponent', () => {
  let component: PozosFormComponent;
  let fixture: ComponentFixture<PozosFormComponent>;
  const propietarioA = { id_usuario: 1, nombre: 'Propietario A', documento_rut: 'A-1', telefono: '091 A', email: 'a@example.test', roles: ['propietario'] };
  const propietarioB = { id_usuario: 2, nombre: 'Propietario B', documento_rut: null, telefono: null, email: null, roles: ['propietario'] };

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
    expect(component.propietarioEdicion()?.body.documento_rut).toBe('');expect(component.propietarioEdicion()?.body.email).toBe('');
    component.propietarioEdicion()!.body.telefono='';
    const emitir=spyOn(component.actualizarPropietario,'emit');component.guardarEditorPropietario();
    expect(emitir).toHaveBeenCalledWith(jasmine.objectContaining({id:1,body:jasmine.objectContaining({telefono:''})}));
  });

  it('abre el editor con los datos del propietario A seleccionado', () => {
    fixture.componentRef.setInput('propietarios', [propietarioA, propietarioB]);
    component.seleccionarPropietario(propietarioA);
    component.abrirEditorPropietario();
    expect(component.propietarioEdicion()).toEqual(jasmine.objectContaining({
      id_usuario: 1,
      body: jasmine.objectContaining({ nombre: 'Propietario A', documento_rut: 'A-1', email: 'a@example.test' }),
    }));
  });

  it('tras A cambiar y crear B edita y guarda exclusivamente los datos de B', () => {
    fixture.componentRef.setInput('propietarios', [propietarioA]);
    component.seleccionarPropietario(propietarioA);
    component.abrirEditorPropietario();
    component.limpiarPropietario();
    const crear = spyOn(component.crearPropietario, 'emit');
    component.propietarioNuevo = { nombre: 'Propietario B' };
    component.registrarPropietario();
    expect(crear).toHaveBeenCalledWith({ nombre: 'Propietario B' });

    fixture.componentRef.setInput('propietarios', [propietarioB, propietarioA]);
    component.pozo().id_propietario = propietarioB.id_usuario;
    component.abrirEditorPropietario();
    expect(component.propietarioEdicion()?.id_usuario).toBe(2);
    expect(component.propietarioEdicion()?.body).toEqual(jasmine.objectContaining({ nombre: 'Propietario B', documento_rut: '', telefono: '', email: '' }));
    component.propietarioEdicion()!.body.nombre = 'Propietario B editado';
    const actualizar = spyOn(component.actualizarPropietario, 'emit');
    component.guardarEditorPropietario();
    expect(actualizar).toHaveBeenCalledWith(jasmine.objectContaining({ id: 2, body: jasmine.objectContaining({ nombre: 'Propietario B editado' }) }));
    expect(propietarioA.nombre).toBe('Propietario A');
  });

  it('resuelve siempre el editor desde el ID actual al alternar A B A y varias veces', () => {
    fixture.componentRef.setInput('propietarios', [propietarioA, propietarioB]);
    for (const persona of [propietarioA, propietarioB, propietarioA, propietarioB, propietarioA]) {
      component.seleccionarPropietario(persona);
      component.abrirEditorPropietario();
      expect(component.propietarioEdicion()?.id_usuario).toBe(persona.id_usuario);
      expect(component.propietarioEdicion()?.body.nombre).toBe(persona.nombre);
    }
  });

  it('cancelar descarta temporales y reabrir carga al propietario actual', () => {
    fixture.componentRef.setInput('propietarios', [propietarioA, propietarioB]);
    component.seleccionarPropietario(propietarioA);
    component.abrirEditorPropietario();
    component.propietarioEdicion()!.body.nombre = 'Temporal';
    component.cerrarEditorPropietario();
    component.seleccionarPropietario(propietarioB);
    component.abrirEditorPropietario();
    expect(component.propietarioEdicion()?.body.nombre).toBe('Propietario B');
    expect(component.pozo().id_propietario).toBe(2);
  });

  it('falla cerrado si el ID cambia durante la edición', () => {
    fixture.componentRef.setInput('propietarios', [propietarioA, propietarioB]);
    component.seleccionarPropietario(propietarioA);
    component.abrirEditorPropietario();
    component.pozo().id_propietario = propietarioB.id_usuario;
    const actualizar = spyOn(component.actualizarPropietario, 'emit');
    component.guardarEditorPropietario();
    expect(actualizar).not.toHaveBeenCalled();
    expect(component.propietarioEdicion()).toBeNull();
    expect(component.errorMessage()).toContain('cambió durante la edición');
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
