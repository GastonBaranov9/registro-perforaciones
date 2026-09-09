import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { NativeBackendConfigService } from '../../core/native/native-backend-config.service';
import { AuthService } from './auth-service/auth.service';
import { WebsocketService } from './websocket.service';

class NativeWebSocketControlado {
  static instances: NativeWebSocketControlado[] = [];
  readyState = 0;
  onopen: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onclose: ((event: CloseEvent) => unknown) | null = null;
  closeCalls = 0;

  constructor(public readonly url: string) { NativeWebSocketControlado.instances.push(this); }
  open(): void { this.readyState = 1; this.onopen?.(new Event('open')); }
  serverClose(code = 1006): void { this.readyState = 3; this.onclose?.(new CloseEvent('close', { code })); }
  close(code?: number, reason?: string): void {
    this.closeCalls += 1;
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }
}

describe('WebsocketService native', () => {
  let service: WebsocketService;
  let controller: HttpTestingController;
  let authState: 'authenticated' | 'logout-pending' = 'authenticated';
  let generation = 7;
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    authState = 'authenticated';
    generation = 7;
    originalWebSocket = globalThis.WebSocket;
    NativeWebSocketControlado.instances = [];
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
      NativeWebSocketControlado as unknown as typeof WebSocket;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            isWeb: () => false,
            isNative: () => true,
            userId: () => 7,
            state: () => authState,
            nativeRequestAuthSnapshot: () => ({ token: 'not-used-by-ws', generation }),
            handleNative401: jasmine.createSpy('handleNative401').and.resolveTo(),
            handleNative426: jasmine.createSpy('handleNative426').and.resolveTo(),
          },
        },
        {
          provide: NativeBackendConfigService,
          useValue: {
            origin: () => new URL('https://api.example.test'),
            nativeAuthUrl: (path: string) => new URL(path, 'https://api.example.test').toString(),
          },
        },
      ],
    });
    controller = TestBed.inject(HttpTestingController);
    service = TestBed.inject(WebsocketService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    controller.verify();
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
  });

  function ticket(char: string): string {
    return `rspw1_${char.repeat(43)}`;
  }

  it('pide ticket por HTTP y abre WSS sólo con ticket, nunca Bearer', fakeAsync(() => {
    service.connect();
    service.connect();
    const request = controller.expectOne('https://api.example.test/api/auth/native/ws-ticket');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush({ ticket: ticket('A'), expires_at: new Date().toISOString() });
    flushMicrotasks();

    expect(NativeWebSocketControlado.instances.length).toBe(1);
    const url = new URL(NativeWebSocketControlado.instances[0].url);
    expect(url.protocol).toBe('wss:');
    expect(url.origin).toBe('wss://api.example.test');
    expect(url.searchParams.get('ticket')).toBe(ticket('A'));
    expect(NativeWebSocketControlado.instances[0].url).not.toContain('not-used-by-ws');
    service.connect();
    expect(NativeWebSocketControlado.instances.length).toBe(1);
  }));

  it('disconnect invalida y cancela un ticket pendiente antes de permitir B', fakeAsync(() => {
    service.connect();
    const requestA = controller.expectOne('https://api.example.test/api/auth/native/ws-ticket');
    service.disconnect();
    expect(requestA.cancelled).toBeTrue();

    service.connect();
    const pending = controller.match('https://api.example.test/api/auth/native/ws-ticket');
    expect(pending.length).toBe(1);
    const requestB = pending.find((request) => !request.cancelled);
    expect(requestB).toBeDefined();
    requestB!.flush({ ticket: ticket('F') });
    flushMicrotasks();
    expect(NativeWebSocketControlado.instances.length).toBe(1);
    expect(NativeWebSocketControlado.instances[0].url).toContain(ticket('F'));
  }));

  it('timeout cancela el ticket pendiente, libera el flight y reconecta con ticket nuevo', fakeAsync(() => {
    service.connect();
    const requestA = controller.expectOne('https://api.example.test/api/auth/native/ws-ticket');
    tick(9_999);
    expect(requestA.cancelled).toBeFalse();
    tick(1);
    flushMicrotasks();
    expect(requestA.cancelled).toBeTrue();
    tick(999);
    controller.expectNone('https://api.example.test/api/auth/native/ws-ticket');
    tick(1);
    const requestB = controller.expectOne('https://api.example.test/api/auth/native/ws-ticket');
    requestB.flush({ ticket: ticket('L') });
    flushMicrotasks();
    expect(NativeWebSocketControlado.instances.length).toBe(1);
    expect(NativeWebSocketControlado.instances[0].url).toContain(ticket('L'));
  }));

  it('timeout stale tras logout no programa reconnect', fakeAsync(() => {
    service.connect();
    const request = controller.expectOne('https://api.example.test/api/auth/native/ws-ticket');
    authState = 'logout-pending';
    tick(10_000);
    flushMicrotasks();
    expect(request.cancelled).toBeTrue();
    tick(60_000);
    controller.expectNone('https://api.example.test/api/auth/native/ws-ticket');
    expect(NativeWebSocketControlado.instances.length).toBe(0);
  }));

  it('un cierre 4001 es terminal para la generation reemplazada y no solicita otro ticket', fakeAsync(() => {
    service.connect();
    controller.expectOne('https://api.example.test/api/auth/native/ws-ticket').flush({ ticket: ticket('G') });
    flushMicrotasks();
    const socket = NativeWebSocketControlado.instances[0];
    socket.open();
    socket.serverClose(4001);
    tick(60_000);
    controller.expectNone('https://api.example.test/api/auth/native/ws-ticket');
    expect(NativeWebSocketControlado.instances.length).toBe(1);
  }));

  it('una generation nueva puede conectar después de un 4001 terminal', fakeAsync(() => {
    service.connect();
    controller.expectOne('https://api.example.test/api/auth/native/ws-ticket').flush({ ticket: ticket('H') });
    flushMicrotasks();
    NativeWebSocketControlado.instances[0].serverClose(4001);
    generation = 8;
    service.connect();
    controller.expectOne('https://api.example.test/api/auth/native/ws-ticket').flush({ ticket: ticket('I') });
    flushMicrotasks();
    expect(NativeWebSocketControlado.instances.length).toBe(2);
    expect(NativeWebSocketControlado.instances[1].url).toContain(ticket('I'));
  }));

  it('callbacks de un socket viejo no afectan al socket actualmente rastreado', fakeAsync(() => {
    service.connect();
    controller.expectOne('https://api.example.test/api/auth/native/ws-ticket').flush({ ticket: ticket('J') });
    flushMicrotasks();
    const socketA = NativeWebSocketControlado.instances[0];
    socketA.serverClose();
    generation = 8;
    service.connect();
    controller.expectOne('https://api.example.test/api/auth/native/ws-ticket').flush({ ticket: ticket('K') });
    flushMicrotasks();
    const socketB = NativeWebSocketControlado.instances[1];
    socketA.onerror?.(new Event('error'));
    socketA.onclose?.(new CloseEvent('close', { code: 4001 }));
    expect(service.ws).toBe(socketB as unknown as WebSocket);
    tick(60_000);
    controller.expectNone('https://api.example.test/api/auth/native/ws-ticket');
  }));

  it('reconnect solicita un ticket nuevo y no reutiliza el anterior', fakeAsync(() => {
    service.connect();
    controller.expectOne('https://api.example.test/api/auth/native/ws-ticket').flush({ ticket: ticket('B') });
    flushMicrotasks();
    const first = NativeWebSocketControlado.instances[0];
    first.open();
    first.serverClose();
    tick(1_000);
    const secondRequest = controller.expectOne('https://api.example.test/api/auth/native/ws-ticket');
    secondRequest.flush({ ticket: ticket('C') });
    flushMicrotasks();
    expect(NativeWebSocketControlado.instances.length).toBe(2);
    expect(NativeWebSocketControlado.instances[1].url).toContain(ticket('C'));
    expect(NativeWebSocketControlado.instances[1].url).not.toContain(ticket('B'));
  }));

  it('descarta un ticket cuya generation quedó obsoleta', fakeAsync(() => {
    service.connect();
    const request = controller.expectOne('https://api.example.test/api/auth/native/ws-ticket');
    generation = 8;
    request.flush({ ticket: ticket('D') });
    flushMicrotasks();
    expect(NativeWebSocketControlado.instances.length).toBe(0);
  }));

  it('logout-pending no conecta y desconectar cancela el reconnect', fakeAsync(() => {
    authState = 'logout-pending';
    service.connect();
    controller.expectNone('https://api.example.test/api/auth/native/ws-ticket');
    authState = 'authenticated';
    service.connect();
    controller.expectOne('https://api.example.test/api/auth/native/ws-ticket').flush({ ticket: ticket('E') });
    flushMicrotasks();
    NativeWebSocketControlado.instances[0].serverClose();
    service.disconnect();
    tick(60_000);
    controller.expectNone('https://api.example.test/api/auth/native/ws-ticket');
    expect(NativeWebSocketControlado.instances.length).toBe(1);
  }));
});
