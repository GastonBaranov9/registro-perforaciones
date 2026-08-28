import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CAPACITOR_RUNTIME } from '../../../core/native/native-plugin.tokens';
import { AuthService } from './auth.service';
import { RuntimePlatformUnknownError } from '../../../core/native/runtime-platform.service';

describe('AuthService runtime unknown', () => {
  let controller: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: CAPACITOR_RUNTIME, useValue: { getPlatform: () => 'linux', isNativePlatform: () => false } },
      ],
    });
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('marca client-error durante bootstrap sin restaurar cookie ni sesión native', async () => {
    const service = TestBed.inject(AuthService);
    await service.bootstrap();
    expect(service.state()).toBe('client-error');
    controller.expectNone(() => true);
  });

  it('rechaza login sin emitir una solicitud de credenciales', async () => {
    const service = TestBed.inject(AuthService);
    await expectAsync(service.logged('a@b.test', 'secreto')).toBeRejectedWithError(RuntimePlatformUnknownError);
    expect(service.state()).toBe('client-error');
    controller.expectNone(() => true);
  });
});
