import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonContent,
  IonSpinner,
  ToastController,
} from '@ionic/angular/standalone';
import { RolesListService } from '../../../../shared/services/roles-list.service';
import { UsuariosCreateService } from '../../../../shared/services/usuarios-create.service';
import {
  Rol,
  UsuarioCrearBody,
  UsuarioFormulario,
} from '../../../../shared/types/schemas';
import { UsuarioFormComponent } from '../../components/usuario-form/usuario-form.component';
import { validarRolesSeleccionados } from '../../../../shared/utils/roles-seleccion';

@Component({
  selector: 'app-usuarios-create',
  imports: [
    CommonModule,
    IonButton,
    IonCard,
    IonCardContent,
    IonContent,
    IonSpinner,
    UsuarioFormComponent,
  ],
  templateUrl: './usuarios-create.page.html',
  styleUrl: './usuarios-create.page.css',
})
export class UsuariosCreatePage {
  public toastController = inject(ToastController);
  public createService: UsuariosCreateService = inject(UsuariosCreateService);
  private readonly rolesListService = inject(RolesListService);
  public router: Router = inject(Router);
  public errorMessage = signal<string>('');
  public disabled = signal<boolean>(false);
  public roles = signal<Rol[]>([]);
  public cargandoRoles = signal<boolean>(false);
  public rolesCargados = signal<boolean>(false);
  public errorCargaRoles = signal<string>('');

  constructor() {
    void this.cargarRoles();
  }

  public async cargarRoles(): Promise<void> {
    this.cargandoRoles.set(true);
    this.rolesCargados.set(false);
    this.errorCargaRoles.set('');
    this.roles.set([]);

    try {
      const roles = await this.rolesListService.getRoles();
      const rolesSinDuplicados = Array.from(
        new Map(roles.map((rol) => [rol.id_rol, rol])).values()
      );

      this.roles.set(rolesSinDuplicados);
      this.rolesCargados.set(true);
    } catch {
      this.errorCargaRoles.set('No se pudo cargar el catálogo de roles.');
    } finally {
      this.cargandoRoles.set(false);
    }
  }

  async guardarUsuario(usuario: UsuarioFormulario) {
    try {
      this.disabled.set(true);

      const roles = validarRolesSeleccionados(usuario.roles, this.roles());
      const body: UsuarioCrearBody = {
        email: usuario.email.trim(),
        nombre: usuario.nombre.trim(),
        password: usuario.password,
        activo: usuario.activo,
        roles,
      };

      await this.createService.createUsuario(body);

      await this.router.navigate(['/usuarios-list']);
    } catch (error: unknown) {
      const toast = await this.toastController.create({
        message:
          error instanceof Error ? error.message : 'No se pudo crear el usuario',
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
