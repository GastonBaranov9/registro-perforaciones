import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { UsuariosListService } from '../../../../shared/services/usuarios-list.service';
import { UsuarioPublico } from '../../../../shared/types/schemas';
import {
  IonCol,
  IonGrid,
  IonItem,
  IonLabel,
  IonList,
  IonPickerColumn,
  IonRow,
  IonButton,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardSubtitle,
  IonCardContent,
  IonContent,
} from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { ViewWillEnter } from '@ionic/angular/standalone';
import { DatePipe, JsonPipe } from '@angular/common';
import { WebsocketService } from '../../../../shared/services/websocket.service';

@Component({
  selector: 'app-usuarios-list',
  imports: [
    IonButton,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    DatePipe,
    IonContent,
  ],
  templateUrl: './usuarios-list.page.html',
  styleUrl: './usuarios-list.page.css',
})
export class UsuariosListPage implements OnInit, ViewWillEnter {
  public usuarioListService = inject(UsuariosListService);
  private router = inject(Router);
  public usuarios = signal<UsuarioPublico[]>([]);
  public webSocketService = inject(WebsocketService);

  async ngOnInit(): Promise<void> {
    const usuarios = await this.usuarioListService.getListaUsuarios();
    this.usuarios.set(usuarios);
  }

    async ionViewWillEnter() {
    const usuarios = await this.usuarioListService.getListaUsuarios();
    this.usuarios.set(usuarios);
  }


  public wsCambio = effect(async () => {
    if (this.webSocketService.msgRecargarEditUser()) {
      const usuarios = await this.usuarioListService.getListaUsuarios();
      this.usuarios.set(usuarios);
      this.webSocketService.msgRecargarEditUser.set(false)
    }
  });


  public getRoles(usuario: UsuarioPublico) {
    if (!usuario.roles) return 'Sin Rol';

    return usuario.roles.map((r) => r.nombre).join(', ');
  }

  irAEditar(usuario: UsuarioPublico) {
    this.router.navigate(['/usuarios-edit', usuario.id_usuario]);
  }

  public async borrarUser(usuario: UsuarioPublico) {
    await this.usuarioListService.deleteUsuario(usuario.id_usuario);
    this.ionViewWillEnter();
  }
}
