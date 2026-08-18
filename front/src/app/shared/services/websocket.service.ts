import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { AuthService } from './auth-service/auth.service';
import { environment } from '../../../environments/environment';

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 10_000] as const;
const WEBSOCKET_CONNECTING = 0;
const WEBSOCKET_OPEN = 1;

@Injectable({
  providedIn: 'root',
})
export class WebsocketService implements OnDestroy {
  private authService = inject(AuthService);
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private reconnectEnabled = false;
  private destroyed = false;
  public ws?: WebSocket;
  msgRecargarEditUser = signal(false);
  msgRecargarCrearPozo = signal(false);
  msgRecargarEditPozo = signal(false);
  msgRecargarDeletePozo = signal(false);
  connected = signal(false);

  connect(): void {
    if (this.destroyed || this.authService.userId() === null) return;
    this.reconnectEnabled = true;
    this.clearReconnectTimer();
    if (this.ws && (this.ws.readyState === WEBSOCKET_CONNECTING || this.ws.readyState === WEBSOCKET_OPEN)) return;
    this.openSocket();
  }

  private openSocket(): void {
    if (!this.reconnectEnabled || this.destroyed || this.authService.userId() === null) return;
    let socket: WebSocket;
    try { socket = new WebSocket(environment.wsUrl); }
    catch { this.scheduleReconnect(); return; }
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.reconnectAttempt = 0;
      this.connected.set(true);
    };

    socket.onmessage = async (event) => {
      if (this.ws !== socket) return;
      const msg = JSON.parse(event.data);
      if (!msg.data) return;
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
        case 'deletepozo':
          this.msgRecargarDeletePozo.set(true);
          break;
      }
    };

    socket.onerror = () => { /* close decide si corresponde reconectar */ };
    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = undefined;
      this.connected.set(false);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled || this.destroyed || this.authService.userId() === null || this.reconnectTimer) return;
    if (this.reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
      this.reconnectEnabled = false;
      return;
    }
    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt++];
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === undefined) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    const socket = this.ws;
    this.ws = undefined;
    this.connected.set(false);
    if (socket && (socket.readyState === WEBSOCKET_CONNECTING || socket.readyState === WEBSOCKET_OPEN))
      socket.close(1000, 'Cierre intencional');
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
  }
}
