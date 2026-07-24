import { Component, output } from '@angular/core';
import { Camera, CameraResultType } from '@capacitor/camera';
import { IonButton, IonImg } from '@ionic/angular/standalone';
@Component({
  selector: 'app-foto',
  templateUrl: './foto.component.html',
  styleUrls: ['./foto.component.css'],
  imports: [IonButton, IonImg],
})
export class FotoComponent {
  public foto: string | undefined = undefined;
  public fotoTomada = output<string>();

  public async tomarFoto() {
    const imagen = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Uri,
    });

    this.foto = imagen.webPath;

    if (!this.foto) throw new Error();
    this.fotoTomada.emit(this.foto);
  }
}
