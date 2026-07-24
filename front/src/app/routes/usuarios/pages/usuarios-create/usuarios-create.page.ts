import { Component, inject, input, resource, signal } from '@angular/core';
import { UsuariosCreateService } from '../../../../shared/services/usuarios-create.service';
import { Router } from '@angular/router';
import { Rol, UsuarioBody } from '../../../../shared/types/schemas';
import { IonContent, IonCard, IonCardContent, ToastController } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { UsuarioFormComponent } from '../../components/usuario-form/usuario-form.component';

@Component({
  selector: 'app-usuarios-create',
  imports: [CommonModule, IonContent, IonCard, IonCardContent, UsuarioFormComponent],
  templateUrl: './usuarios-create.page.html',
  styleUrl: './usuarios-create.page.css',
})
export class UsuariosCreatePage {
    public toastController = inject(ToastController)

  public createService: UsuariosCreateService = inject(UsuariosCreateService);
  public router: Router = inject(Router);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
 public roles = signal<Rol[]>([
    { id_rol: 1, nombre: 'administracion', descr: 'Administración' },
    { id_rol: 2, nombre: 'perforador', descr: 'Técnico de perforación' },
    { id_rol: 3, nombre: 'propietario', descr: 'Propietario del sitio' }
  ]);



  async guardarUsuario(usuario: UsuarioBody) {
    console.log(usuario);

    try {
      this.disabled.set(true);
      const nuevoUsuario = await this.createService.createUsuario(usuario);
      console.log('Usuario creado: ', nuevoUsuario);
      this.router.navigate(['/usuarios-list']);
    } catch (err: any) {
      const toast = await this.toastController.create({
        message: err.error.message,
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
