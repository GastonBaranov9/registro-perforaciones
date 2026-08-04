import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpInterceptorFn, withInterceptors } from '@angular/common/http';

import { tokenInterceptor } from './token-interceptor';
import { environment } from '../../../environments/environment';

describe('tokenInterceptor', () => {
  const interceptor: HttpInterceptorFn = (req, next) => 
    TestBed.runInInjectionContext(() => tokenInterceptor(req, next));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([tokenInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
  });

  it('envÃ­a credenciales a la API sin cabecera Bearer', () => {
    const http = TestBed.inject(HttpClient);
    const controller = TestBed.inject(HttpTestingController);

    const url = environment.apiURL + 'login';
    http.get(url).subscribe();
    const request = controller.expectOne(url);
    expect(request.request.withCredentials).toBeTrue();
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush({});
  });

  it('agrega el token CSRF a operaciones mutables de la API', () => {
    document.cookie = 'rsp_csrf=valor-csrf; path=/';
    const http = TestBed.inject(HttpClient);
    const controller = TestBed.inject(HttpTestingController);

    const url = environment.apiURL + 'recurso';
    http.post(url, {}).subscribe();
    const request = controller.expectOne(url);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('valor-csrf');
    request.flush({});
    document.cookie = 'rsp_csrf=; Max-Age=0; path=/';
  });

  it('should be created', () => {
    expect(interceptor).toBeTruthy();
  });
});
