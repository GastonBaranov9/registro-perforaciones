import { Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonItem,
  IonLabel,
  IonInput,
  IonToggle,
  IonList,
  IonButton,
  IonSelect,
  IonSelectOption,
  IonListHeader,
} from '@ionic/angular/standalone';
import { Rol, UsuarioBody } from '../../../../shared/types/schemas';
import { CommonModule } from '@angular/common';
import { MainStore } from '../../../../shared/services/mainstore-service/main.store';

@Component({
  selector: 'app-usuario-form',
  imports: [
    CommonModule,
    FormsModule,
    IonItem,
    IonLabel,
    IonInput,
    IonToggle,
    IonList,
    IonButton,
    IonSelect,
    IonSelectOption,
  ],
  templateUrl: './usuario-form.component.html',
})
export class UsuarioFormComponent {
  public user = input<UsuarioBody>({
    email: '',
    nombre: '',
    password: '',
    activo: true,
    roles: [],
  });

  public mainStore = inject(MainStore);

  public roles = input.required<Rol[]>();

  public isAdmin() {
    let roles = this.mainStore.user()?.roles;
    if (!roles) return false;
    for (const rol of roles) {
      if (rol.nombre === 'administracion') return true;
    }
    return false;
  }
  public saved = output<UsuarioBody>();

  compareWith(o1: Rol | null, o2: Rol | null): boolean {
    return o1 && o2 ? o1.id_rol === o2.id_rol : o1 === o2;
  }

  handleSubmit() {
    this.saved.emit(this.user());
  }
}
