import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccionFotoEdicion, CandidatoPozo, NuevoPozo } from '../../../../shared/types/schemas';
import { IonItem, IonLabel, IonInput, IonButton, IonToggle, IonList, IonText, IonImg, IonDatetime, IonItemDivider } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FotoComponent, FotoSeleccionada } from '../../../fotos/components/foto/foto.component';
import { environment } from '../../../../../environments/environment';
import { SelectorPersonaPozoComponent } from '../selector-persona-pozo/selector-persona-pozo.component';

@Component({
  selector: 'app-pozos-form',
  templateUrl: './pozos-form.component.html',
  styleUrls: ['./pozos-form.component.scss'],
  imports: [
    IonItem,
    IonLabel,
    IonInput,
    IonButton,
    IonToggle,
    IonList,
    CommonModule,
    FormsModule,
    FotoComponent,
    IonImg,
    SelectorPersonaPozoComponent,
],
})
export class PozosFormComponent {
  public pozo = input.required<NuevoPozo>();
  public id_pozo = input<number | null>(null);
  public propietarios = input<CandidatoPozo[]>([]);
  public perforadores = input<CandidatoPozo[]>([]);
  public catalogosDisponibles = input(false);

  public saved = output<{ pozo: NuevoPozo; foto: File | null; fotoAccion: AccionFotoEdicion }>();
  public crearSitio = output<void>();
  public editarSitio = output<void>();
  public eliminarFotoPersistida = output<void>();
  public cambiado = output<NuevoPozo>();

  public disabled = signal<boolean>(false);
  public agregareditar = input<boolean>(false);
  public guardando = input<boolean>(false);
  public errorMessage = signal<string>('');

  public fotoBlob: File | null = null;
  public fotoFile: File | null = null;
  public fotoVistaPrevia = signal<string | null>(null);
  public eliminarFotoPendiente = signal(false);

  handlePozo() {
    this.saved.emit({
      pozo: this.pozo(),
      foto: this.fotoFile,
      fotoAccion: this.fotoFile ? 'reemplazar' : (this.eliminarFotoPendiente() ? 'eliminar' : 'conservar'),
    });
  }

  notificarCambio() { this.cambiado.emit({ ...this.pozo() }); }

  onCrearSitioClick() {
    this.crearSitio.emit();
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
    return this.propietarios().some((p) => p.id_usuario === Number(this.pozo().id_propietario)) &&
      this.perforadores().some((p) => p.id_usuario === Number(this.pozo().id_perforador));
  }
  propietarioValido() { return this.propietarios().some((p) => p.id_usuario === Number(this.pozo().id_propietario)); }

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
