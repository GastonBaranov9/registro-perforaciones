import { HttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { AuthService } from '../../shared/services/auth-service/auth.service';
import { NativeBackendConfigService } from '../native/native-backend-config.service';
import { NativeMetadataService } from '../native/native-metadata.service';
import { RuntimePlatformService, RuntimePlatformUnknownError } from '../native/runtime-platform.service';
import { tokenInterceptor } from './token-interceptor';

describe('tokenInterceptor runtime unknown', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([tokenInterceptor])),
        provideHttpClientTesting(),
        { provide: RuntimePlatformService, useValue: { platform: () => 'unknown' } },
        { provide: NativeBackendConfigService, useValue: { isAuthorizedApiRequest: (url: string) => { const parsed = new URL(url); return parsed.origin === 'https://backend.example.test' && parsed.pathname.startsWith('/api/'); }, origin: () => new URL('https://backend.example.test') } },
        { provide: NativeMetadataService, useValue: { current: jasmine.createSpy('current') } },
        { provide: AuthService, useValue: { nativeAuthorizationFor: jasmine.createSpy('nativeAuthorizationFor') } },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('rechaza API propia antes de enviar y no cae en transporte web', async () => {
    let error: unknown;
    http.get('https://backend.example.test/api/pozos').subscribe({ error: (value) => (error = value) });
    await Promise.resolve();
    expect(error instanceof RuntimePlatformUnknownError).toBeTrue();
    controller.expectNone(() => true);
  });

  it('deja pasar URL externa sin credenciales', () => {
    http.get('https://maps.googleapis.com/maps/api/staticmap').subscribe();
    const request = controller.expectOne('https://maps.googleapis.com/maps/api/staticmap');
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush({});
  });
});
