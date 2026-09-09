import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { Subscription, timeout } from 'rxjs';
import { AuthService } from './auth-service/auth.service';
import { environment } from '../../../environments/environment';
import {
  NATIVE_AUTH_PUBLIC_PATHS,
  NativeBackendConfigService,
} from '../../core/native/native-backend-config.service';

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 10_000] as const;
const SLOW_RECONNECT_DELAY_MS = 30_000;
const WEBSOCKET_CONNECTING = 0;
const WEBSOCKET_OPEN = 1;
const NATIVE_WS_TICKET = NATIVE_AUTH_PUBLIC_PATHS.wsTicket;
const NATIVE_WS_TICKET_TIMEOUT_MS = 10_000;
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
  private reconnectEpoch?: number;
  private connectionEpoch = 0;
  private nativeConnectFlight?: Promise<void>;
  private nativeConnectGeneration?: number;
  private nativeTicketRequest?: { cancel: () => void };
  private replacedNativeGeneration?: number;
  private closedWebAuthGeneration?: number;
  private wsEpoch?: number;
  private destroyed = false;
  public ws?: WebSocket;
  msgRecargarEditUser = signal(false);
  msgRecargarCrearPozo = signal(false);
  msgRecargarEditPozo = signal(false);
  msgRecargarDeletePozo = signal(false);
  connected = signal(false);

  connect(): void {
    if (this.destroyed || !this.canConnect()) return;
    if (this.authService.isWeb()) {
      const authSnapshot = this.authService.webSessionSnapshot();
      if (this.closedWebAuthGeneration !== undefined) {
        if (this.closedWebAuthGeneration === authSnapshot.generation) return;
        this.closedWebAuthGeneration = undefined;
      }
    }
    this.reconnectEnabled = true;
    this.clearReconnectTimer();
    if (this.ws && (this.ws.readyState === WEBSOCKET_CONNECTING || this.ws.readyState === WEBSOCKET_OPEN)) return;
    let nativeGeneration: number | undefined;
    if (this.authService.isNative()) {
      const authSnapshot = this.authService.nativeRequestAuthSnapshot(NATIVE_WS_TICKET);
      if (!authSnapshot) return;
      nativeGeneration = authSnapshot.generation;
      if (this.replacedNativeGeneration !== undefined) {
        if (this.replacedNativeGeneration === nativeGeneration) return;
        this.replacedNativeGeneration = undefined;
      }
      if (this.nativeConnectFlight) {
        if (this.nativeConnectGeneration === nativeGeneration) return;
        this.invalidateNativeAttempt();
      }
    }
    const epoch = this.authService.isNative() ? ++this.connectionEpoch : undefined;
    const flight = this.openSocket(epoch);
    if (this.authService.isNative()) {
      this.nativeConnectFlight = flight;
      this.nativeConnectGeneration = nativeGeneration;
      void flight.then(
        () => this.clearNativeConnectFlight(flight),
        () => this.clearNativeConnectFlight(flight),
      );
    } else void flight;
  }

  private canConnect(): boolean {
    if (this.authService.isWeb()) return this.authService.userId() !== null;
    return this.authService.isNative() && this.authService.state() === 'authenticated';
  }

  private async openSocket(attemptEpoch?: number): Promise<void> {
    if (!this.attemptIsCurrent(attemptEpoch) || !this.reconnectEnabled || this.destroyed || !this.canConnect()) return;
    let url: string;
    let generation: number | undefined;
    try {
      if (this.authService.isNative()) {
        const authSnapshot = this.authService.nativeRequestAuthSnapshot(NATIVE_WS_TICKET);
        if (!authSnapshot || this.authService.state() !== 'authenticated') return;
        // The native Bearer remains inside the HttpClient interceptor. This
        // service only retains the generation needed to reject stale replies.
        generation = authSnapshot.generation;
        const response = await this.requestNativeTicket();
        if (
          !this.attemptIsCurrent(attemptEpoch) || !this.reconnectEnabled || this.destroyed || !this.canConnect() ||
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
      if (!this.attemptIsCurrent(attemptEpoch)) return;
      if (generation !== undefined && !this.generationIsCurrent(generation)) return;
      if (error instanceof HttpErrorResponse && error.status === 401) {
        await this.authService.handleNative401(generation);
        return;
      }
      if (error instanceof HttpErrorResponse && error.status === 426) {
        await this.authService.handleNative426();
        return;
      }
      this.scheduleReconnect(generation, attemptEpoch);
      return;
    }

    if (!this.attemptIsCurrent(attemptEpoch) || !this.reconnectEnabled || this.destroyed || !this.canConnect()) return;
    let socket: WebSocket;
    try { socket = new WebSocket(url); }
    catch { this.scheduleReconnect(generation, attemptEpoch); return; }
    const socketGeneration = generation;
    const socketEpoch = attemptEpoch;
    this.ws = socket;
    this.wsEpoch = socketEpoch;

    socket.onopen = () => {
      if (!this.isTrackedSocket(socket, socketEpoch)) return;
      if (socketGeneration !== undefined && !this.generationIsCurrent(socketGeneration)) {
        socket.close(4003, 'Sesion no autorizada');
        return;
      }
      this.reconnectAttempt = 0;
      this.connected.set(true);
    };

    socket.onmessage = async (event) => {
      if (!this.isTrackedSocket(socket, socketEpoch)) return;
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
    socket.onclose = (event) => {
      if (!this.isTrackedSocket(socket, socketEpoch)) return;
      this.ws = undefined;
      this.wsEpoch = undefined;
      this.connected.set(false);
      if (event.code === 4003 && this.authService.isWeb()) {
        this.reconnectEnabled = false;
        this.clearReconnectTimer();
        const authSnapshot = this.authService.webSessionSnapshot();
        this.closedWebAuthGeneration = authSnapshot.generation;
        void this.authService.synchronizeWebSession(authSnapshot.generation);
        return;
      }
      if (event.code === 4001 && socketGeneration !== undefined && this.generationIsCurrent(socketGeneration)) {
        this.replacedNativeGeneration = socketGeneration;
        this.reconnectEnabled = false;
        this.clearReconnectTimer();
        return;
      }
      this.scheduleReconnect(socketGeneration, socketEpoch);
    };
  }

  private scheduleReconnect(generation?: number, attemptEpoch?: number): void {
    if (!this.reconnectEnabled || this.destroyed || !this.canConnect() || this.reconnectTimer) return;
    if (!this.attemptIsCurrent(attemptEpoch)) return;
    if (generation !== undefined && !this.generationIsCurrent(generation)) return;
    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt] ?? SLOW_RECONNECT_DELAY_MS;
    if (this.reconnectAttempt < RECONNECT_DELAYS_MS.length) this.reconnectAttempt += 1;
    this.reconnectGeneration = generation;
    this.reconnectEpoch = attemptEpoch;
    const timerEpoch = this.reconnectEpoch;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.reconnectEpoch !== timerEpoch || !this.attemptIsCurrent(timerEpoch)) return;
      if (this.reconnectGeneration !== undefined && !this.generationIsCurrent(this.reconnectGeneration)) return;
      this.reconnectGeneration = undefined;
      this.reconnectEpoch = undefined;
      if (this.authService.isNative()) this.connect();
      else void this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === undefined) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private requestNativeTicket(): Promise<{ ticket: string } | undefined> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let subscription: Subscription | undefined;
      const request = {
        cancel: () => {
          if (settled) return;
          settled = true;
          subscription?.unsubscribe();
          if (this.nativeTicketRequest === request) this.nativeTicketRequest = undefined;
          resolve(undefined);
        },
      };
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (this.nativeTicketRequest === request) this.nativeTicketRequest = undefined;
        callback();
      };
      this.nativeTicketRequest = request;
      subscription = this.httpClient.post<{ ticket: string }>(
        this.backendConfig.nativeAuthUrl(NATIVE_WS_TICKET),
        null,
      ).pipe(timeout({ each: NATIVE_WS_TICKET_TIMEOUT_MS })).subscribe({
        next: (response) => finish(() => resolve(response)),
        error: (error: unknown) => finish(() => reject(error)),
        complete: () => finish(() => resolve(undefined)),
      });
      if (settled) subscription.unsubscribe();
    });
  }

  private clearNativeConnectFlight(flight: Promise<void>): void {
    if (this.nativeConnectFlight !== flight) return;
    this.nativeConnectFlight = undefined;
    this.nativeConnectGeneration = undefined;
  }

  private invalidateNativeAttempt(): void {
    this.connectionEpoch += 1;
    this.nativeTicketRequest?.cancel();
    this.nativeConnectFlight = undefined;
    this.nativeConnectGeneration = undefined;
  }

  private attemptIsCurrent(epoch?: number): boolean {
    return epoch === undefined || epoch === this.connectionEpoch;
  }

  private isTrackedSocket(socket: WebSocket, epoch?: number): boolean {
    return this.ws === socket && this.wsEpoch === epoch;
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.reconnectGeneration = undefined;
    this.reconnectEpoch = undefined;
    if (this.authService.isNative()) {
      this.invalidateNativeAttempt();
    }
    const socket = this.ws;
    this.ws = undefined;
    this.wsEpoch = undefined;
    this.connected.set(false);
    if (socket && (socket.readyState === WEBSOCKET_CONNECTING || socket.readyState === WEBSOCKET_OPEN))
      socket.close(1000, 'Cierre intencional');
  }

  private generationIsCurrent(generation: number): boolean {
    try {
      return this.authService.nativeRequestAuthSnapshot(NATIVE_WS_TICKET)?.generation === generation;
    } catch {
      return false;
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
  }
}
