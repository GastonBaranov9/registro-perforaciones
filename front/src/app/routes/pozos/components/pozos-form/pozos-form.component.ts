import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccionFotoEdicion, CandidatoPozo, NuevoPozo } from '../../../../shared/types/schemas';
import { IonItem, IonLabel, IonInput, IonButton, IonToggle, IonList, IonText, IonImg, IonDatetime, IonItemDivider } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FotoComponent } from '../../../fotos/components/foto/foto.component';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
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

  public disabled = signal<boolean>(false);
  private authService = inject(AuthService);
  public agregareditar = input<boolean>(false);
  public guardando = input<boolean>(false);
  public errorMessage = signal<string>('');

  public fotoBlob: File | null = null;
  public fotoFile: File | null = null;
  public eliminarFotoPendiente = signal(false);

  handlePozo() {
    this.saved.emit({
      pozo: this.pozo(),
      foto: this.fotoFile,
      fotoAccion: this.fotoFile ? 'reemplazar' : (this.eliminarFotoPendiente() ? 'eliminar' : 'conservar'),
    });
  }

  onCrearSitioClick() {
    this.crearSitio.emit();
  }

  onEditarSitioClick() {
    this.editarSitio.emit();
  }

  async fotoCapturada(fotoWebPath: string) {
    try {
      this.disabled.set(true);
      const response = await fetch(fotoWebPath);
      const blob = await response.blob();

      this.fotoBlob = new File([blob], 'pozo-foto.jpg', {
        type: blob.type || 'image/jpeg',
      });

      this.fotoFile = this.fotoBlob;
      this.eliminarFotoPendiente.set(false);

      const idUsuario = this.authService.userId();
      if (!idUsuario) throw new Error();
    } catch (error: unknown) {
      console.error('Error subiendo la foto:', error);
      this.errorMessage.set(error instanceof Error ? error.message : 'Error subiendo foto');
    }
    this.disabled.set(false);
  }

  quitarFotoSeleccionada() {
    this.fotoBlob = null;
    this.fotoFile = null;
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
