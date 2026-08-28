import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccionFotoEdicion, CandidatoPozo, NuevoPozo, PropietarioOperativoActualizarBody, PropietarioOperativoCrearBody, Sitio, SitioBody } from '../../../../shared/types/schemas';
import { IonItem, IonLabel, IonInput, IonButton, IonList, IonText, IonImg, IonTextarea, IonSelect, IonSelectOption } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FotoComponent, FotoSeleccionada } from '../../../fotos/components/foto/foto.component';
import { environment } from '../../../../../environments/environment';
import { SelectorPersonaPozoComponent } from '../selector-persona-pozo/selector-persona-pozo.component';
import { capturarUbicacionActual } from '../../../../shared/utils/geolocalizacion';
import { EjeCoordenada, normalizarCoordenadaTexto } from '../../../../shared/utils/coordenadas';
import { CampoTecnicoEstandar } from '../../../../shared/constants/datos-tecnicos-estandar';
import { DEPARTAMENTOS_URUGUAY } from '../../../../shared/constants/departamentos-uruguay';
import { ProtectedResourceDirective } from '../../../../core/resources/protected-resource.directive';

type PropietarioEdicionEstado = {
  id_usuario: number;
  body: PropietarioOperativoCrearBody;
};

@Component({
  selector: 'app-pozos-form',
  templateUrl: './pozos-form.component.html',
  styleUrls: ['./pozos-form.component.scss'],
  imports: [
    IonItem,
    IonLabel,
    IonInput,
    IonTextarea,
    IonSelect,
    IonSelectOption,
    IonButton,
    IonList,
    IonText,
    CommonModule,
    FormsModule,
    FotoComponent,
    IonImg,
    SelectorPersonaPozoComponent,
    ProtectedResourceDirective,
],
})
export class PozosFormComponent {
  public pozo = input.required<NuevoPozo>();
  public id_pozo = input<number | null>(null);
  public propietarios = input<CandidatoPozo[]>([]);
  public perforadores = input<CandidatoPozo[]>([]);
  public sitios = input<Sitio[]>([]);
  public sitioNuevo = input<SitioBody | null>(null);
  public buscarPropietarios = input<((q: string) => Promise<CandidatoPozo[]>) | null>(null);
  public buscarPerforadores = input<((q: string) => Promise<CandidatoPozo[]>) | null>(null);
  public catalogosDisponibles = input(false);
  public perforadorBloqueado = input(false);

  public saved = output<{ pozo: NuevoPozo; foto: File | null; fotoAccion: AccionFotoEdicion }>();
  public crearPropietario = output<PropietarioOperativoCrearBody>();
  public actualizarPropietario = output<{ id: number; body: PropietarioOperativoActualizarBody }>();
  public editarSitio = output<void>();
  public eliminarFotoPersistida = output<void>();
  public cambiado = output<NuevoPozo>();

  public disabled = signal<boolean>(false);
  public agregareditar = input<boolean>(false);
  public guardando = input<boolean>(false);
  public errorMessage = signal<string>('');
  public ubicacionPrecision = signal<number | null>(null);
  public ubicacionError = signal('');
  public capturandoUbicacion = signal(false);
  readonly departamentos = DEPARTAMENTOS_URUGUAY;
  public propietarioNuevo: PropietarioOperativoCrearBody = propietarioVacio();
  public propietarioSeleccionadoDatos = signal<CandidatoPozo | null>(null);
  public propietarioEdicion = signal<PropietarioEdicionEstado | null>(null);
  public camposTecnicosEditables = signal<Set<CampoTecnicoEstandar>>(new Set());
  datoTecnicoEditable(campo: CampoTecnicoEstandar) { return this.camposTecnicosEditables().has(campo); }
  editarDatoTecnico(campo: CampoTecnicoEstandar) {
    this.camposTecnicosEditables.update((actual) => new Set(actual).add(campo));
  }
  propietarioSeleccionado() { return Number(this.pozo().id_propietario) > 0; }
  sitioActual() { return this.sitios().find((sitio) => sitio.id_sitio === Number(this.pozo().id_sitio)) ?? null; }

  public fotoBlob: File | null = null;
  public fotoFile: File | null = null;
  public fotoVistaPrevia = signal<string | null>(null);
  public eliminarFotoPendiente = signal(false);

  handlePozo() {
    const sitio=this.sitioNuevo();
    if(sitio){
      const latitud=normalizarCoordenadaTexto(sitio.latitud,'latitud'),longitud=normalizarCoordenadaTexto(sitio.longitud,'longitud');
      if(!latitud||!longitud){this.ubicacionError.set('Las coordenadas no son válidas.');return;}
      sitio.latitud=latitud;sitio.longitud=longitud;
    }
    this.saved.emit({
      pozo: this.pozo(),
      foto: this.fotoFile,
      fotoAccion: this.fotoFile ? 'reemplazar' : (this.eliminarFotoPendiente() ? 'eliminar' : 'conservar'),
    });
  }

  notificarCambio() { this.cambiado.emit({ ...this.pozo() }); }

  async tomarUbicacionNueva() {
    const sitio = this.sitioNuevo();
    if (!sitio || this.capturandoUbicacion()) return;
    try {
      this.capturandoUbicacion.set(true); this.ubicacionError.set('');
      const ubicacion = await capturarUbicacionActual();
      sitio.latitud = ubicacion.latitud; sitio.longitud = ubicacion.longitud;
      this.ubicacionPrecision.set(ubicacion.precision ?? null);
    } catch (error: unknown) {
      this.ubicacionError.set(error instanceof Error ? error.message : 'No fue posible obtener la ubicación.');
    } finally { this.capturandoUbicacion.set(false); }
  }

  normalizarCoordenadaNueva(eje:EjeCoordenada) {
    const sitio=this.sitioNuevo();if(!sitio)return;
    const normalizada=normalizarCoordenadaTexto(sitio[eje],eje);
    if(!normalizada){this.ubicacionError.set(`La ${eje} no es válida.`);return;}
    sitio[eje]=normalizada;this.ubicacionError.set('');
  }

  registrarPropietario() {
    const nombre = this.propietarioNuevo.nombre.trim();
    if (!nombre) return;
    this.propietarioSeleccionadoDatos.set(null);
    this.propietarioEdicion.set(null);
    this.errorMessage.set('');
    this.crearPropietario.emit({ ...this.propietarioNuevo, nombre });
  }

  seleccionarPropietario(persona: CandidatoPozo) {
    this.pozo().id_propietario = persona.id_usuario;
    this.propietarioSeleccionadoDatos.set(persona);
    this.propietarioEdicion.set(null);
    this.errorMessage.set('');
    this.notificarCambio();
  }
  abrirEditorPropietario() {
    const id = Number(this.pozo().id_propietario);
    const cache = this.propietarioSeleccionadoDatos();
    const persona = this.propietarios().find((p) => p.id_usuario === id)
      ?? (cache?.id_usuario === id ? cache : null);
    if (!persona) {
      this.propietarioEdicion.set(null);
      this.errorMessage.set('No se pudieron cargar los datos del propietario seleccionado. Vuelva a seleccionarlo.');
      return;
    }
    this.errorMessage.set('');
    this.propietarioEdicion.set({
      id_usuario: id,
      body: {
        nombre: persona.nombre, documento_rut: persona.documento_rut ?? '', telefono: persona.telefono ?? '',
        email: persona.email ?? '', direccion: persona.direccion ?? '', localidad: persona.localidad ?? '',
        departamento: persona.departamento ?? '', observaciones: persona.observaciones ?? '',
      },
    });
  }
  guardarEditorPropietario() {
    const editor = this.propietarioEdicion();
    const idActual = Number(this.pozo().id_propietario);
    if (!editor?.body.nombre.trim() || idActual <= 0) return;
    if (editor.id_usuario !== idActual) {
      this.propietarioEdicion.set(null);
      this.errorMessage.set('La selección de propietario cambió durante la edición. Abra nuevamente el editor.');
      return;
    }
    this.errorMessage.set('');
    this.actualizarPropietario.emit({ id: editor.id_usuario, body: { ...editor.body, nombre: editor.body.nombre.trim() } });
  }
  cerrarEditorPropietario() { this.propietarioEdicion.set(null); this.errorMessage.set(''); }

  limpiarPropietario() {
    this.pozo().id_propietario = 0;
    this.propietarioSeleccionadoDatos.set(null);
    this.propietarioEdicion.set(null);
    this.errorMessage.set('');
    this.notificarCambio();
  }

  onEditarSitioClick() {
    this.editarSitio.emit();
  }

  fotoCapturada(foto: FotoSeleccionada) {
    this.fotoBlob = foto.archivo;
    this.fotoFile = foto.archivo;
    this.fotoVistaPrevia.set(foto.vistaPrevia);
    this.eliminarFotoPendiente.set(false);
    this.errorMessage.set('');
  }

  quitarFotoSeleccionada() {
    this.fotoBlob = null;
    this.fotoFile = null;
    this.fotoVistaPrevia.set(null);
  }

  cancelarCambioFoto() {
    this.quitarFotoSeleccionada();
    this.eliminarFotoPendiente.set(false);
  }

  solicitarEliminarFotoPersistida() {
    this.eliminarFotoPendiente.set(true);
    this.quitarFotoSeleccionada();
  }
  personasValidas() {
    return Number(this.pozo().id_propietario) > 0 && Number(this.pozo().id_perforador) > 0;
  }

getFoto() {
  const foto = this.pozo()?.foto_url;
  if (!foto) return null;

  if (foto.startsWith('http')) {
    return foto;
  }

  let path = foto;

  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  return environment.serverURL + path;
}
}

function propietarioVacio(): PropietarioOperativoCrearBody {
  return { nombre: '', documento_rut: '', telefono: '', email: '', direccion: '', localidad: '', departamento: '', observaciones: '' };
}
