import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth-service/auth.service';
import { environment } from '../../../environments/environment';
import { NativeBackendConfigService } from '../../core/native/native-backend-config.service';

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 10_000] as const;
const SLOW_RECONNECT_DELAY_MS = 30_000;
const WEBSOCKET_CONNECTING = 0;
const WEBSOCKET_OPEN = 1;
const NATIVE_WS_TICKET = 'auth/native/ws-ticket';
const NATIVE_TICKET_PATTERN = /^rspw1_[A-Za-z0-9_-]{43}$/;

@Injectable({
  providedIn: 'root',
})
export class WebsocketService implements OnDestroy {
  private authService = inject(AuthService);
  private httpClient = inject(HttpClient);
  private backendConfig = inject(NativeBackendConfigService);
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private reconnectEnabled = false;
  private reconnectGeneration?: number;
  private destroyed = false;
  public ws?: WebSocket;
  msgRecargarEditUser = signal(false);
  msgRecargarCrearPozo = signal(false);
  msgRecargarEditPozo = signal(false);
  msgRecargarDeletePozo = signal(false);
  connected = signal(false);

  connect(): void {
    if (this.destroyed || !this.canConnect()) return;
    this.reconnectEnabled = true;
    this.clearReconnectTimer();
    if (this.ws && (this.ws.readyState === WEBSOCKET_CONNECTING || this.ws.readyState === WEBSOCKET_OPEN)) return;
    void this.openSocket();
  }

  private canConnect(): boolean {
    if (this.authService.isWeb()) return this.authService.userId() !== null;
    return this.authService.isNative() && this.authService.state() === 'authenticated';
  }

  private async openSocket(): Promise<void> {
    if (!this.reconnectEnabled || this.destroyed || !this.canConnect()) return;
    let url: string;
    let generation: number | undefined;
    try {
      if (this.authService.isNative()) {
        const authSnapshot = this.authService.nativeRequestAuthSnapshot(`/api/${NATIVE_WS_TICKET}`);
        if (!authSnapshot || this.authService.state() !== 'authenticated') return;
        // The native Bearer remains inside the HttpClient interceptor. This
        // service only retains the generation needed to reject stale replies.
        generation = authSnapshot.generation;
        const response = await firstValueFrom(
          this.httpClient.post<{ ticket: string }>(environment.apiURL + NATIVE_WS_TICKET, null),
        );
        if (
          !this.reconnectEnabled || this.destroyed || !this.canConnect() ||
          !this.generationIsCurrent(generation) ||
          typeof response?.ticket !== 'string' || !NATIVE_TICKET_PATTERN.test(response.ticket)
        ) return;
        const wsUrl = new URL('/ws', this.backendConfig.origin());
        wsUrl.protocol = 'wss:';
        wsUrl.searchParams.set('ticket', response.ticket);
        url = wsUrl.toString();
      } else {
        url = environment.wsUrl;
      }
    } catch (error) {
      if (generation !== undefined && !this.generationIsCurrent(generation)) return;
      if (error instanceof HttpErrorResponse && error.status === 401) {
        await this.authService.handleNative401(generation);
        return;
      }
      if (error instanceof HttpErrorResponse && error.status === 426) {
        await this.authService.handleNative426();
        return;
      }
      this.scheduleReconnect(generation);
      return;
    }

    if (!this.reconnectEnabled || this.destroyed || !this.canConnect()) return;
    let socket: WebSocket;
    try { socket = new WebSocket(url); }
    catch { this.scheduleReconnect(generation); return; }
    this.ws = socket;
    const socketGeneration = generation;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      if (socketGeneration !== undefined && !this.generationIsCurrent(socketGeneration)) {
        socket.close(4003, 'Sesion no autorizada');
        return;
      }
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
      this.scheduleReconnect(socketGeneration);
    };
  }

  private scheduleReconnect(generation?: number): void {
    if (!this.reconnectEnabled || this.destroyed || !this.canConnect() || this.reconnectTimer) return;
    if (generation !== undefined && !this.generationIsCurrent(generation)) return;
    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt] ?? SLOW_RECONNECT_DELAY_MS;
    if (this.reconnectAttempt < RECONNECT_DELAYS_MS.length) this.reconnectAttempt += 1;
    this.reconnectGeneration = generation;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (
        this.reconnectGeneration !== undefined &&
        !this.generationIsCurrent(this.reconnectGeneration)
      ) return;
      this.reconnectGeneration = undefined;
      void this.openSocket();
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
    this.reconnectGeneration = undefined;
    const socket = this.ws;
    this.ws = undefined;
    this.connected.set(false);
    if (socket && (socket.readyState === WEBSOCKET_CONNECTING || socket.readyState === WEBSOCKET_OPEN))
      socket.close(1000, 'Cierre intencional');
  }

  private generationIsCurrent(generation: number): boolean {
    try {
      return this.authService.nativeRequestAuthSnapshot(`/api/${NATIVE_WS_TICKET}`)?.generation === generation;
    } catch {
      return false;
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
  }
}
