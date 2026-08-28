import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { NativeBackendConfigService } from '../native/native-backend-config.service';
import { RuntimePlatformService } from '../native/runtime-platform.service';
import { ProtectedResourceService, ProtectedResourceUrlError } from './protected-resource.service';

describe('ProtectedResourceService', () => {
  const backendOrigin = 'https://backend.example.test';
  let http: HttpClient;
  let controller: HttpTestingController;
  let runtimePlatform: 'web' | 'android' | 'ios' | 'unknown';
  let loader: ProtectedResourceService;

  beforeEach(() => {
    runtimePlatform = 'android';
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RuntimePlatformService, useValue: { platform: () => runtimePlatform } },
        { provide: NativeBackendConfigService, useValue: { isAuthorizedApiRequest: (url: string) => new URL(url).origin === backendOrigin && new URL(url).pathname.startsWith('/api/') } },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    loader = TestBed.inject(ProtectedResourceService);
  });

  afterEach(() => controller.verify());

  it('carga un recurso native como Blob y revoca el object URL de forma idempotente', async () => {
    const create = spyOn(URL, 'createObjectURL').and.returnValue('blob:protected-1');
    const revoke = spyOn(URL, 'revokeObjectURL');
    const result = loader.load(`${backendOrigin}/api/usuarios/7/pozos/3/foto`);
    let handle: { url: string; revoke(): void } | undefined;
    result.subscribe((value) => (handle = value));
    const request = controller.expectOne(`${backendOrigin}/api/usuarios/7/pozos/3/foto`);
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['image'], { type: 'image/png' }));
    expect(handle?.url).toBe('blob:protected-1');
    expect(create).toHaveBeenCalledTimes(1);
    handle?.revoke();
    handle?.revoke();
    expect(revoke).toHaveBeenCalledOnceWith('blob:protected-1');
  });

  it('rechaza origins externos sin iniciar requests autenticados', () => {
    let error: unknown;
    loader.load('https://maps.googleapis.com/maps/api/staticmap').subscribe({ error: (value) => (error = value) });
    expect(error instanceof ProtectedResourceUrlError).toBeTrue();
    controller.expectNone(() => true);
  });

  it('usa el mismo transporte autenticado para el mapa aereo protegido', () => {
    const result = loader.load(`${backendOrigin}/api/usuarios/7/sitios/2/mapa-aereo/preview?latitud=-34&longitud=-56`);
    result.subscribe((handle) => handle.revoke());
    const request = controller.expectOne(`${backendOrigin}/api/usuarios/7/sitios/2/mapa-aereo/preview?latitud=-34&longitud=-56`);
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['map'], { type: 'image/png' }));
  });

  it('preserva URL propia web sin transformar a Blob', () => {
    runtimePlatform = 'web';
    const value = '/api/usuarios/7/pozos/3/foto';
    let handle: { url: string; revoke(): void } | undefined;
    loader.load(value).subscribe((result) => (handle = result));
    expect(handle?.url).toBe(value);
    controller.expectNone(() => true);
  });

  it('rechaza un runtime desconocido y no usa fallback web', () => {
    runtimePlatform = 'unknown';
    let error: unknown;
    loader.load(`${backendOrigin}/api/usuarios/7/pozos/3/foto`).subscribe({ error: (value) => (error = value) });
    expect(error?.constructor.name).toBe('RuntimePlatformUnknownError');
    controller.expectNone(() => true);
  });
});
