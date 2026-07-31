import { Component, effect, inject, input, resource, signal } from '@angular/core';
import { UsuariosEditService } from '../../../../shared/services/usuarios-edit.service';
import { Router } from '@angular/router';
import {
  Rol,
  UsuarioActualizarBody,
  UsuarioFormulario,
} from '../../../../shared/types/schemas';
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

public userResource = resource({
  params: () => ({ id: this.id_usuario() }),

  loader: async ({ params }): Promise<UsuarioFormulario> => {
    const usuario = await this.editService.getUsuarioById(params.id);

    return {
      email: usuario.email,
      nombre: usuario.nombre,
      password: '',
      activo: usuario.activo,
      roles: usuario.roles ?? [],
    };
  },
});

  public roles = signal<Rol[]>([
    { id_rol: 1, nombre: 'administracion', descr: 'Administración' },
    { id_rol: 2, nombre: 'perforador', descr: 'Técnico de perforación' },
    { id_rol: 3, nombre: 'propietario', descr: 'Propietario del sitio' },
  ]);

  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);

async handleEdit(usuario: UsuarioFormulario) {
  const body: UsuarioActualizarBody = {
    email: usuario.email.trim(),
    nombre: usuario.nombre.trim(),
    activo: usuario.activo,
    roles: usuario.roles,
    ...(usuario.password.length > 0
      ? { password: usuario.password }
      : {}),
  };

  try {
    this.disabled.set(true);

    const editado = await this.editService.editUsuario(
      this.id_usuario(),
      body
    );

    console.log('Usuario editado:', editado);

    await this.router.navigate(['/usuarios-list']);
  } catch (err: any) {
    const toast = await this.toastController.create({
      message: err.message ?? 'No se pudo editar el usuario',
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
