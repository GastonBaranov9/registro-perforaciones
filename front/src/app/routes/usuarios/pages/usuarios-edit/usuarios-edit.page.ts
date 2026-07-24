import { Component, effect, inject, input, resource, signal } from '@angular/core';
import { UsuariosEditService } from '../../../../shared/services/usuarios-edit.service';
import { Router } from '@angular/router';
import { Rol, Usuario, UsuarioBody } from '../../../../shared/types/schemas';
import {
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonInput,
  IonToggle,
  IonButton,
  IonCard,
  IonCardContent,
} from '@ionic/angular/standalone';
import { CommonModule, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UsuarioFormComponent } from '../../components/usuario-form/usuario-form.component';
import { ToastController } from '@ionic/angular';
import { WebsocketService } from '../../../../shared/services/websocket.service';

@Component({
  selector: 'app-usuarios-edit',
  imports: [
    IonButton,
    IonCard,
    IonCardContent,
    FormsModule,
    IonContent,
    CommonModule,
    UsuarioFormComponent,
  ],
  templateUrl: './usuarios-edit.page.html',
  styleUrl: './usuarios-edit.page.css',
})
export class UsuariosEditPage {
  public toastController = inject(ToastController)
  public editService: UsuariosEditService = inject(UsuariosEditService);
  public id_usuario = input.required<number>();
  private router: Router = inject(Router);
  public webSocketService = inject(WebsocketService)

  public userResource = resource({
    params: () => ({ id: this.id_usuario() }),
    loader: ({ params }) => this.editService.getUsuarioById(params.id),
  });

  public roles = signal<Rol[]>([
    { id_rol: 1, nombre: 'administracion', descr: 'Administración' },
    { id_rol: 2, nombre: 'perforador', descr: 'Técnico de perforación' },
    { id_rol: 3, nombre: 'propietario', descr: 'Propietario del sitio' },
  ]);

  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);

  async handleEdit(usuario: UsuarioBody) {
    try {
      this.disabled.set(true);
      this.webSocketService.ws?.send(JSON.stringify({type: "Usuario editado", id_usuario: this.id_usuario()}) )
      const editado = await this.editService.editPersona(this.id_usuario(), usuario);
      console.log('Usuario editado', editado);
      this.router.navigate(['/usuarios-list']);
    } catch (err: any) {
      const toast = await this.toastController.create({
        message: err.message,
        duration: 1000,
        position: 'bottom',
        color: 'danger',
        animated: true

      });

      await toast.present();
    }
    this.disabled.set(false);
  }
}
