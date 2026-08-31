import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { Router } from '@angular/router';
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
  serverClose(code = 1006): void { this.readyState = 3;this.onclose?.(new CloseEvent('close', { code })); }
  close(code?: number, reason?: string): void {
    this.closeCalls += 1;this.readyState = 3;this.onclose?.(new CloseEvent('close', { code, reason }));
  }
}

describe('WebsocketService', () => {
  let service: WebsocketService;
  let controller: HttpTestingController;
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
    controller = TestBed.inject(HttpTestingController);
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

  it('cierre web 4003 revalida, limpia la sesión inválida y no reconecta', fakeAsync(() => {
    const auth = TestBed.inject(AuthService);
    service.connect();
    const socket = WebSocketControlado.instances[0];
    socket.open();
    socket.serverClose(4003);
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    userId = null;

    const validation = controller.expectOne('/api/login');
    expect(validation.request.method).toBe('GET');
    validation.flush({ code: 'ERR4_T05' }, { status: 401, statusText: 'Unauthorized' });
    flushMicrotasks();
    expect(auth.state()).toBe('unauthenticated');
    expect(auth.userId()).toBeNull();
    expect(service.connected()).toBeFalse();
    expect(navigate).toHaveBeenCalledOnceWith('/login');
    jasmine.clock().tick(60_000);
    expect(WebSocketControlado.instances.length).toBe(1);
  }));

  it('cierre web 4003 sigue siendo terminal aunque la revalidación confirme la sesión', fakeAsync(() => {
    const auth = TestBed.inject(AuthService);
    service.connect();
    const socket = WebSocketControlado.instances[0];
    socket.open();
    socket.serverClose(4003);

    const validation = controller.expectOne('/api/login');
    validation.flush({
      id_usuario: 41,
      email: 'usuario@example.test',
      nombre: 'Usuario vigente',
      activo: true,
      fecha_registro: '2026-01-01T00:00:00.000Z',
      roles: [],
    });
    flushMicrotasks();

    expect(auth.state()).toBe('authenticated');
    expect(service.connected()).toBeFalse();
    expect(WebSocketControlado.instances.length).toBe(1);
    service.connect();
    expect(WebSocketControlado.instances.length).toBe(1);
    jasmine.clock().tick(60_000);
    expect(WebSocketControlado.instances.length).toBe(1);
  }));

  it('cierre web 4003 stale no destruye una sesión autenticada nueva', fakeAsync(() => {
    const auth = TestBed.inject(AuthService);
    service.connect();
    const socket = WebSocketControlado.instances[0];
    socket.open();
    socket.serverClose(4003);
    flushMicrotasks();
    const staleValidation = controller.expectOne((request) =>
      request.method === 'GET' && request.url === '/api/login',
    );

    const login = auth.logged('nueva@example.test', 'clave-nueva');
    controller.expectOne((request) => request.method === 'POST' && request.url === '/api/login')
      .flush({ authenticated: true });
    flushMicrotasks();
    controller.expectOne('/api/login').flush({
      id_usuario: 41,
      email: 'nueva@example.test',
      nombre: 'Nueva sesión',
      activo: true,
      fecha_registro: '2026-01-01T00:00:00.000Z',
      roles: [],
    });
    flushMicrotasks();
    expect(auth.state()).toBe('authenticated');
    service.connect();
    expect(WebSocketControlado.instances.length).toBe(2);
    staleValidation.flush({ code: 'ERR4_T05' }, { status: 401, statusText: 'Unauthorized' });
    flushMicrotasks();
    expect(auth.state()).toBe('authenticated');
    expect(auth.userId()).toBe(41);
    expect(WebSocketControlado.instances.length).toBe(2);
    expect(service.connected()).toBeFalse();
  }));

  it('cierre 4003 stale del socket A no afecta al socket B vigente', fakeAsync(() => {
    service.connect();
    const socketA = WebSocketControlado.instances[0];
    socketA.open();
    socketA.serverClose(1006);
    jasmine.clock().tick(1_000);
    const socketB = WebSocketControlado.instances[1];
    socketB.open();

    socketA.serverClose(4003);

    expect(service.ws).toBe(socketB as unknown as WebSocket);
    expect(service.connected()).toBeTrue();
    controller.expectNone('/api/login');
    jasmine.clock().tick(60_000);
    expect(WebSocketControlado.instances.length).toBe(2);
  }));

  it('cierre web recuperable conserva el reconnect', () => {
    service.connect();
    const socket = WebSocketControlado.instances[0];
    socket.open();
    socket.serverClose(1006);
    jasmine.clock().tick(999);
    expect(WebSocketControlado.instances.length).toBe(1);
    jasmine.clock().tick(1);
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
