import { Component, inject, input, resource, signal } from '@angular/core';
import { UsuariosCreateService } from '../../../../shared/services/usuarios-create.service';
import { Router } from '@angular/router';
import {
  Rol,
  UsuarioCrearBody,
  UsuarioFormulario,
} from '../../../../shared/types/schemas';
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

async guardarUsuario(usuario: UsuarioFormulario) {
  const body: UsuarioCrearBody = {
    email: usuario.email.trim(),
    nombre: usuario.nombre.trim(),
    password: usuario.password,
    activo: usuario.activo,
    roles: usuario.roles,
  };

  try {
    this.disabled.set(true);

    await this.createService.createUsuario(body);

    await this.router.navigate(['/usuarios-list']);
  } catch (err: any) {
    const toast = await this.toastController.create({
      message: err.message ?? 'No se pudo crear el usuario',
      duration: 2000,
      position: 'bottom',
      color: 'danger',
      animated: true,
    });

    await toast.present();
  } finally {
    this.disabled.set(false);
  }
}
}
