import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  isDevMode,
} from '@angular/core';
import { provideRouter, RouteReuseStrategy, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { provideIonicAngular, IonicRouteStrategy } from '@ionic/angular/standalone';

import { routes } from './app.routes';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { tokenInterceptor } from './core/interceptors/token-interceptor';
import { provideServiceWorker } from '@angular/service-worker';
import { AuthService } from './shared/services/auth-service/auth.service';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // Cancelar Atrás restaura la posición del historial sin sobrescribir la página previa.
    provideRouter(routes, withComponentInputBinding(), withRouterConfig({ canceledNavigationResolution: 'computed' })),
    provideIonicAngular(),
    provideHttpClient(withFetch(), withInterceptors([tokenInterceptor])),
    provideAppInitializer(() => inject(AuthService).bootstrap()),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideServiceWorker('ngsw-worker.js', {
      enabled: String(environment.nativeBuildMode) === 'web' && !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
