import { Component, inject, OnInit } from '@angular/core';
import { MainStore } from '../../../../shared/services/mainstore-service/main.store';
import { UsuariosEditPage } from '../usuarios-edit/usuarios-edit.page';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
} from '@ionic/angular/standalone';
import { DatePipe } from '@angular/common';
import { Rol } from '../../../../shared/types/schemas';
import { AuthService } from '../../../../shared/services/auth-service/auth.service';

@Component({
  selector: 'app-usuario-detail',
  imports: [
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    DatePipe,
  ],
  templateUrl: './usuario-detail.page.html',
  styleUrl: './usuario-detail.page.css',
})
export class UsuarioDetailPage implements OnInit {
  public mainStore = inject(MainStore);
  public router = inject(Router);
  private authService = inject(AuthService);
  public usuario = this.mainStore.user();
  public rolesString: string = '';
  ngOnInit() {
    if (this.usuario?.roles) {
      this.rolesString = this.usuario?.roles.map((r) => r.nombre).join(", ");
    }
  }

public async logOut() {
  await this.authService.logout();
  await this.router.navigate(['/login']);
}

  public irAEditarUser() {
    if (!this.usuario) throw new Error('Usuario no encontrado');
    this.router.navigate([`usuarios-edit/${this.usuario.id_usuario}`]);
  }
}
