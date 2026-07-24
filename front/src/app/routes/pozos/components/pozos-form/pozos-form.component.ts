import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NuevoPozo } from '../../../../shared/types/schemas';
import { IonItem, IonLabel, IonInput, IonButton, IonToggle, IonList, IonText, IonImg, IonDatetime, IonItemDivider } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FotoComponent } from '../../../fotos/components/foto/foto.component';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';
import { environment } from '../../../../../environments/environment';

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
],
})
export class PozosFormComponent {
  public pozo = input.required<NuevoPozo>();
  public id_pozo = input<number | null>(null);

  public saved = output<{ pozo: NuevoPozo; foto: File | null }>();
  public crearSitio = output<void>();
  public editarSitio = output<void>();

  public disabled = signal<boolean>(false);
  private authService = inject(AuthService);
  public agregareditar = input<boolean>(false);
  public errorMessage = signal<string>('');

  public fotoBlob: File | null = null;
  public fotoFile: File | null = null;

  handlePozo() {
    this.saved.emit({
      pozo: this.pozo(),
      foto: this.fotoFile,
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

      const idUsuario = this.authService.userId();
      if (!idUsuario) throw new Error();
    } catch (error: any) {
      console.error('Error subiendo la foto:', error);
      this.errorMessage.set(error.message ?? 'Error subiendo foto');
    }
    this.disabled.set(false);
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
