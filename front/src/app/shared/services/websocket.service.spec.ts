import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth-service/auth.service';
import { WebsocketService } from './websocket.service';
import { environment } from '../../../environments/environment';

class WebSocketControlado {
  static instances: WebSocketControlado[] = [];
  readyState = 0;
  onopen: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onclose: ((event: CloseEvent) => unknown) | null = null;
  closeCalls = 0;

  constructor(public readonly url: string) { WebSocketControlado.instances.push(this); }
  open(): void { this.readyState = 1;this.onopen?.(new Event('open')); }
  serverClose(): void { this.readyState = 3;this.onclose?.(new CloseEvent('close', { code: 1006 })); }
  close(code?: number, reason?: string): void {
    this.closeCalls += 1;this.readyState = 3;this.onclose?.(new CloseEvent('close', { code, reason }));
  }
}

describe('WebsocketService', () => {
  let service: WebsocketService;
  let userId: number | null;
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    WebSocketControlado.instances = [];
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocketControlado as unknown as typeof WebSocket;
    jasmine.clock().install();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const auth = TestBed.inject(AuthService);
    userId = 41;
    spyOn(auth, 'userId').and.callFake(() => userId);
    service = TestBed.inject(WebsocketService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    jasmine.clock().uninstall();
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
  });

  function reachSlowRetry(): void {
    service.connect();
    WebSocketControlado.instances[0].serverClose();
    for (const delay of [1_000, 2_000, 5_000, 10_000, 10_000]) {
      jasmine.clock().tick(delay);
      WebSocketControlado.instances.at(-1)!.serverClose();
    }
    expect(WebSocketControlado.instances.length).toBe(6);
  }

  it('abre una sola conexion y no duplica listeners al repetir connect', () => {
    service.connect();service.connect();
    expect(WebSocketControlado.instances.length).toBe(1);
    expect(WebSocketControlado.instances[0].url).toBe(environment.wsUrl);
    WebSocketControlado.instances[0].open();
    expect(service.connected()).toBeTrue();
    service.connect();
    expect(WebSocketControlado.instances.length).toBe(1);
  });

  it('reconecta un cierre inesperado con backoff inicial', () => {
    service.connect();
    const primera = WebSocketControlado.instances[0];
    primera.open();primera.serverClose();
    expect(service.connected()).toBeFalse();
    jasmine.clock().tick(999);
    expect(WebSocketControlado.instances.length).toBe(1);
    jasmine.clock().tick(1);
    expect(WebSocketControlado.instances.length).toBe(2);
    WebSocketControlado.instances[1].open();
    service.connect();
    expect(WebSocketControlado.instances.length).toBe(2);
  });

  it('logout cierra intencionalmente y cancela toda reconexion', () => {
    service.connect();
    const socket = WebSocketControlado.instances[0];
    socket.open();
    service.disconnect();
    expect(socket.closeCalls).toBe(1);
    expect(service.connected()).toBeFalse();
    jasmine.clock().tick(60_000);
    expect(WebSocketControlado.instances.length).toBe(1);
  });

  it('una sesion revocada detiene el retry lento', () => {
    reachSlowRetry();
    userId = null;
    jasmine.clock().tick(60_000);
    expect(WebSocketControlado.instances.length).toBe(6);
  });

  it('continua con retry lento tras una caida mayor al backoff rapido y recupera sin reload', () => {
    reachSlowRetry();
    jasmine.clock().tick(29_999);
    expect(WebSocketControlado.instances.length).toBe(6);
    jasmine.clock().tick(1);
    expect(WebSocketControlado.instances.length).toBe(7);
    WebSocketControlado.instances[6].open();
    expect(service.connected()).toBeTrue();
    service.connect();service.connect();
    jasmine.clock().tick(60_000);
    expect(WebSocketControlado.instances.length).toBe(7);
  });

  it('tolera maintenance prolongado con un solo intento cada treinta segundos', () => {
    reachSlowRetry();
    for (let intento = 0; intento < 3; intento += 1) {
      jasmine.clock().tick(30_000);
      expect(WebSocketControlado.instances.length).toBe(7 + intento);
      WebSocketControlado.instances.at(-1)!.serverClose();
    }
    jasmine.clock().tick(30_000);
    expect(WebSocketControlado.instances.length).toBe(10);
    WebSocketControlado.instances.at(-1)!.open();
    expect(service.connected()).toBeTrue();
  });

  it('logout durante retry lento cancela el timer y no reconecta', () => {
    reachSlowRetry();
    service.disconnect();
    jasmine.clock().tick(90_000);
    expect(WebSocketControlado.instances.length).toBe(6);
  });

  it('destruir el servicio durante retry lento limpia timers pendientes', () => {
    reachSlowRetry();
    service.ngOnDestroy();
    jasmine.clock().tick(90_000);
    expect(WebSocketControlado.instances.length).toBe(6);
  });
});
