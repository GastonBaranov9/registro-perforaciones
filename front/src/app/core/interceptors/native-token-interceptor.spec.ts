import { HttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { tokenInterceptor } from './token-interceptor';
import { CAPACITOR_RUNTIME } from '../native/native-plugin.tokens';
import { NativeBackendConfigService } from '../native/native-backend-config.service';
import { NativeMetadataService } from '../native/native-metadata.service';
import { AuthService } from '../../shared/services/auth-service/auth.service';

const backendOrigin = 'https://backend.example';
const token = `rspn1_${'A'.repeat(43)}`;

describe('tokenInterceptor native', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let auth: jasmine.SpyObj<AuthService>;
  let metadata: jasmine.SpyObj<NativeMetadataService>;

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('auth', [
      'nativeAuthorizationFor', 'nativeRequestAuthSnapshot', 'handleNative401', 'handleNative426',
    ]);
    auth.nativeAuthorizationFor.and.callFake((pathname) =>
      pathname === '/api/auth/native/login' ? null : token,
    );
    auth.nativeRequestAuthSnapshot.and.callFake((pathname) =>
      pathname === '/api/auth/native/login' ? null : { token, generation: 1 },
    );
    auth.handleNative401.and.resolveTo();
    auth.handleNative426.and.resolveTo();

    metadata = jasmine.createSpyObj<NativeMetadataService>('metadata', ['current']);
    metadata.current.and.resolveTo({ platform: 'android', appBuild: 120, appVersion: '1.4.2' });

    const backend = {
      isAuthorizedApiRequest: (rawUrl: string) => {
        const url = new URL(rawUrl, 'https://localhost/');
        return url.origin === backendOrigin && (url.pathname === '/api' || url.pathname.startsWith('/api/'));
      },
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([tokenInterceptor])),
        provideHttpClientTesting(),
        { provide: CAPACITOR_RUNTIME, useValue: { getPlatform: () => 'android', isNativePlatform: () => true } },
        { provide: NativeBackendConfigService, useValue: backend },
        { provide: NativeMetadataService, useValue: metadata },
        { provide: AuthService, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('adjunta Bearer y metadata sólo al origin/path API exacto', async () => {
    const url = `${backendOrigin}/api/pozos?pagina=2`;
    http.get(url).subscribe();
    await Promise.resolve();
    const request = controller.expectOne(url);
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(request.request.headers.get('X-Native-Platform')).toBe('android');
    expect(request.request.headers.get('X-Native-App-Build')).toBe('120');
    expect(request.request.headers.get('X-Native-App-Version')).toBe('1.4.2');
    expect(request.request.withCredentials).toBeFalse();
    request.flush({});
  });

  it('no filtra Bearer/metadata a ports, evil, subdominios, Maps, blob o data', () => {
    const urls = [
      'https://backend.example:8443/api/pozos',
      'https://backend.example.evil.com/api/pozos',
      'https://sub.backend.example/api/pozos',
      'https://maps.googleapis.com/maps/api/staticmap',
      'blob:https://localhost/id',
      'data:image/png;base64,AAAA',
    ];
    for (const url of urls) {
      http.get(url).subscribe();
      const request = controller.expectOne(url);
      expect(request.request.headers.has('Authorization')).toBeFalse();
      expect(request.request.headers.has('X-Native-Platform')).toBeFalse();
      request.flush({});
    }
    expect(auth.nativeAuthorizationFor).not.toHaveBeenCalled();
  });

  it('login no hereda un Bearer anterior pero sí envía metadata', async () => {
    const url = `${backendOrigin}/api/auth/native/login`;
    http.post(url, { email: 'a@b.test', password: 'secreto', installation_id: 'uuid' }).subscribe();
    await Promise.resolve();
    const request = controller.expectOne(url);
    expect(request.request.headers.has('Authorization')).toBeFalse();
    expect(request.request.headers.get('X-Native-App-Build')).toBe('120');
    request.flush({});
  });

  it('logout-device adjunta sólo Bearer, sin metadata', () => {
    const url = `${backendOrigin}/api/auth/native/logout`;
    http.post(url, null).subscribe();
    const request = controller.expectOne(url);
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${token}`);
    expect(request.request.headers.has('X-Native-App-Build')).toBeFalse();
    expect(metadata.current).not.toHaveBeenCalled();
    request.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('preserva FormData, boundary del browser y opciones binarias', async () => {
    const body = new FormData();
    body.append('foto', new Blob(['imagen'], { type: 'image/png' }), 'foto.png');
    const upload = `${backendOrigin}/api/fotos`;
    http.post(upload, body).subscribe();
    await Promise.resolve();
    const uploadRequest = controller.expectOne(upload);
    expect(uploadRequest.request.body).toBe(body);
    expect(uploadRequest.request.headers.has('Content-Type')).toBeFalse();
    uploadRequest.flush({});

    const pdf = `${backendOrigin}/api/informe.pdf`;
    http.get(pdf, { responseType: 'blob' }).subscribe();
    await Promise.resolve();
    const pdfRequest = controller.expectOne(pdf);
    expect(pdfRequest.request.responseType).toBe('blob');
    pdfRequest.flush(new Blob(['pdf'], { type: 'application/pdf' }));
  });

  it('maneja 401 normal y 426 tipado sin exponer el request', async () => {
    const business = `${backendOrigin}/api/pozos`;
    http.get(business).subscribe({ error: () => undefined });
    await Promise.resolve();
    controller.expectOne(business).flush(
      { code: 'ERR4_T05' },
      { status: 401, statusText: 'Unauthorized' },
    );
    await Promise.resolve();
    expect(auth.handleNative401).toHaveBeenCalledTimes(1);

    http.get(business).subscribe({ error: () => undefined });
    await Promise.resolve();
    controller.expectOne(business).flush(
      { code: 'NATIVE_APP_UPGRADE_REQUIRED' },
      { status: 426, statusText: 'Upgrade Required' },
    );
    await Promise.resolve();
    expect(auth.handleNative426).toHaveBeenCalledTimes(1);
  });

  it('ignora un 401 cuya generación quedó obsoleta tras cambiar de token', async () => {
    let generation = 1;
    auth.nativeRequestAuthSnapshot.and.callFake((pathname) =>
      pathname === '/api/auth/native/login' ? null : { token, generation },
    );
    const requestPromise = new Promise<void>((resolve) => {
      http.get(`${backendOrigin}/api/pozos`).subscribe({ error: () => resolve() });
    });
    await Promise.resolve();
    const request = controller.expectOne(`${backendOrigin}/api/pozos`);
    generation = 2;
    request.flush({ code: 'ERR4_T05' }, { status: 401, statusText: 'Unauthorized' });
    await requestPromise;
    expect(auth.handleNative401).toHaveBeenCalledOnceWith(1);
  });
});
