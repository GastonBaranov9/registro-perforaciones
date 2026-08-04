import { CommonModule } from '@angular/common';
import { Component, inject, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonSpinner,
} from '@ionic/angular/standalone';
import { RolesListService } from '../../../../shared/services/roles-list.service';
import { UsuariosEditService } from '../../../../shared/services/usuarios-edit.service';
import {
  Rol,
  UsuarioActualizarBody,
  UsuarioFormulario,
  UsuarioPublico,
} from '../../../../shared/types/schemas';
import { UsuarioFormComponent } from '../../components/usuario-form/usuario-form.component';
import { validarRolesSeleccionados } from '../../../../shared/utils/roles-seleccion';

type CargaEdicionUsuario = {
  usuario: UsuarioFormulario;
  roles: Rol[];
};

@Component({
  selector: 'app-usuarios-edit',
  imports: [
    CommonModule,
    FormsModule,
    IonButton,
    IonCard,
    IonCardContent,
    IonContent,
    IonSpinner,
    UsuarioFormComponent,
  ],
  templateUrl: './usuarios-edit.page.html',
  styleUrl: './usuarios-edit.page.css',
})
export class UsuariosEditPage {
  public toastController = inject(ToastController);
  public editService: UsuariosEditService = inject(UsuariosEditService);
  private readonly rolesListService = inject(RolesListService);
  public id_usuario = input.required<number>();
  private router: Router = inject(Router);

  public userResource = resource({
    params: () => ({ id: this.id_usuario() }),
    loader: async ({ params }): Promise<CargaEdicionUsuario> => {
      const [usuario, roles] = await Promise.all([
        this.editService.getUsuarioById(params.id),
        this.rolesListService.getRoles(),
      ]);

      return this.reconciliarCarga(usuario, roles);
    },
  });

  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);

  private reconciliarCarga(usuario: UsuarioPublico, roles: Rol[]): CargaEdicionUsuario {
    const catalogoPorId = new Map<number, Rol>();
    for (const rol of roles) {
      catalogoPorId.set(rol.id_rol, rol);
    }
    const catalogoSinDuplicados = Array.from(catalogoPorId.values());

    const rolesUsuarioPorId = new Map<number, Rol>();
    for (const rol of usuario.roles ?? []) {
      rolesUsuarioPorId.set(rol.id_rol, rol);
    }

    const rolesNoDisponibles = Array.from(rolesUsuarioPorId.keys()).filter(
      (idRol) => !catalogoPorId.has(idRol)
    );

    if (rolesNoDisponibles.length > 0) {
      throw new Error(
        'La cuenta posee roles que ya no están disponibles en el catálogo.'
      );
    }

    const rolesSeleccionados = Array.from(rolesUsuarioPorId.keys()).map(
      (idRol) => catalogoPorId.get(idRol)!
    );

    return {
      usuario: {
        email: usuario.email,
        nombre: usuario.nombre,
        password: '',
        activo: usuario.activo,
        roles: rolesSeleccionados,
      },
      roles: catalogoSinDuplicados,
    };
  }

  public mensajeErrorCarga(): string {
    const error = this.userResource.error();
    return error instanceof Error
      ? error.message
      : 'No se pudieron cargar el usuario y el catálogo de roles.';
  }

  async handleEdit(usuario: UsuarioFormulario) {
    try {
      this.disabled.set(true);

      if (!this.userResource.hasValue()) {
        throw new Error('No se pudo validar el catálogo de roles.');
      }

      const roles = validarRolesSeleccionados(
        usuario.roles,
        this.userResource.value().roles
      );
      const body: UsuarioActualizarBody = {
        email: usuario.email.trim(),
        nombre: usuario.nombre.trim(),
        activo: usuario.activo,
        roles,
        ...(usuario.password.length > 0 ? { password: usuario.password } : {}),
      };

      await this.editService.editUsuario(this.id_usuario(), body);

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
