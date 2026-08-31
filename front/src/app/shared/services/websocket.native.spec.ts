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
  serverClose(): void { this.readyState = 3; this.onclose?.(new CloseEvent('close', { code: 1006 })); }
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
          useValue: { origin: () => new URL('https://api.example.test') },
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
    const request = controller.expectOne('/api/auth/native/ws-ticket');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush({ ticket: ticket('A'), expires_at: new Date().toISOString() });
    flushMicrotasks();

    expect(NativeWebSocketControlado.instances.length).toBe(1);
    const url = new URL(NativeWebSocketControlado.instances[0].url);
    expect(url.protocol).toBe('wss:');
    expect(url.origin).toBe('wss://api.example.test');
    expect(url.searchParams.get('ticket')).toBe(ticket('A'));
    expect(NativeWebSocketControlado.instances[0].url).not.toContain('not-used-by-ws');
  }));

  it('reconnect solicita un ticket nuevo y no reutiliza el anterior', fakeAsync(() => {
    service.connect();
    controller.expectOne('/api/auth/native/ws-ticket').flush({ ticket: ticket('B') });
    flushMicrotasks();
    const first = NativeWebSocketControlado.instances[0];
    first.open();
    first.serverClose();
    tick(1_000);
    const secondRequest = controller.expectOne('/api/auth/native/ws-ticket');
    secondRequest.flush({ ticket: ticket('C') });
    flushMicrotasks();
    expect(NativeWebSocketControlado.instances.length).toBe(2);
    expect(NativeWebSocketControlado.instances[1].url).toContain(ticket('C'));
    expect(NativeWebSocketControlado.instances[1].url).not.toContain(ticket('B'));
  }));

  it('descarta un ticket cuya generation quedó obsoleta', fakeAsync(() => {
    service.connect();
    const request = controller.expectOne('/api/auth/native/ws-ticket');
    generation = 8;
    request.flush({ ticket: ticket('D') });
    flushMicrotasks();
    expect(NativeWebSocketControlado.instances.length).toBe(0);
  }));

  it('logout-pending no conecta y desconectar cancela el reconnect', fakeAsync(() => {
    authState = 'logout-pending';
    service.connect();
    controller.expectNone('/api/auth/native/ws-ticket');
    authState = 'authenticated';
    service.connect();
    controller.expectOne('/api/auth/native/ws-ticket').flush({ ticket: ticket('E') });
    flushMicrotasks();
    NativeWebSocketControlado.instances[0].serverClose();
    service.disconnect();
    tick(60_000);
    controller.expectNone('/api/auth/native/ws-ticket');
    expect(NativeWebSocketControlado.instances.length).toBe(1);
  }));
});
