import { inject, Injectable, signal } from '@angular/core';
import { AuthService } from './auth-service/auth.service';
import { environment } from '../../../environments/environment';
import { PozosListService } from './pozos-list.service';
import { PozosListPage } from '../../routes/pozos/pages/pozos-list/pozos-list.page';
@Injectable({
  providedIn: 'root',
})
export class WebsocketService {
  private authService = inject(AuthService);
  public ws?: WebSocket;
  msgRecargarEditUser = signal(false);
  msgRecargarCrearPozo = signal(false);
  msgRecargarEditPozo = signal(false);
  msgRecargarDeletePozo = signal(false);
  connected = signal(false);

  connect(id_usuario: number) {
    this.ws = new WebSocket(environment.wsUrl + id_usuario);
    this.ws.onopen = () => {
      console.log('CONECTADO');
      this.connected.set(true);
    };

    this.ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      console.log('Mensaje enviado', msg);

      if (msg.data) {
        switch (msg.data.type) {
          case 'Usuario editado':
            this.msgRecargarEditUser.set(true);
            await this.authService.getUser();
            break;
          case 'pozo':
            this.msgRecargarCrearPozo.set(true);
            break;
          case 'editpozo':
            this.msgRecargarEditPozo.set(true);
            break;

          case "deletepozo":
            this.msgRecargarDeletePozo.set(true);
            break;

        }
      }
    };

    this.ws.onerror = (error) => {
      console.error('WS Error:', error);
    };

    this.ws.onclose = () => {
      this.connected.set(false);
    };
  }

  disconnect() {
    if (this.connected()) {
      this.ws?.close(1000, 'Cliente cerró la conexión');
      this.connected.set(false);
    }
  }
}
