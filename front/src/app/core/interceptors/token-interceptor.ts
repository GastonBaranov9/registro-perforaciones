import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, Observable, of, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  isWebApiRequest,
  NativeBackendConfigService,
} from '../native/native-backend-config.service';
import { NativeMetadataService } from '../native/native-metadata.service';
import type { NativeAppMetadata } from '../native/native-metadata.service';
import { SKIP_GLOBAL_NATIVE_AUTH_HANDLER } from '../native/native-auth-http-context';
import {
  RuntimePlatformService,
  RuntimePlatformUnknownError,
} from '../native/runtime-platform.service';
import { AuthService } from '../../shared/services/auth-service/auth.service';

const NATIVE_LOGIN_PATH = '/auth/native/login';
const NATIVE_LOGOUT_PATH = '/auth/native/logout';

function requestPath(rawUrl: string): string {
  return new URL(rawUrl, globalThis.location?.href ?? 'https://localhost/').pathname;
}

function errorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function isBlobLike(body: unknown): body is Blob {
  return !!body && typeof body === 'object' && typeof (body as { text?: unknown }).text === 'function';
}

function trustedNativeErrorCode(body: unknown): Observable<string | null> {
  const direct = errorCode(body);
  if (direct) return of(direct);
  if (isBlobLike(body)) {
    return from(body.text()).pipe(
      switchMap((text) => {
        try { return of(errorCode(JSON.parse(text))); } catch { return of(null); }
      }),
      catchError(() => of(null)),
    );
  }
  if (typeof body === 'string') {
    try { return of(errorCode(JSON.parse(body))); } catch { return of(null); }
  }
  return of(null);
}

export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const runtime = inject(RuntimePlatformService);
  const platform = runtime.platform();
  if (platform === 'web') {
    if (!isWebApiRequest(req.url, environment.apiURL)) return next(req);

    let headers = req.headers;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
      const csrfToken = document.cookie
        .split('; ')
        .find((cookie) => cookie.startsWith('rsp_csrf='))
        ?.slice('rsp_csrf='.length);
      if (csrfToken) headers = headers.set('X-CSRF-Token', decodeURIComponent(csrfToken));
    }

    return next(req.clone({ headers, withCredentials: true }));
  }

  const backend = inject(NativeBackendConfigService);
  if (platform === 'unknown') {
    const isOwnApi =
      isWebApiRequest(req.url, environment.apiURL) ||
      backend.isAuthorizedApiRequest(req.url) ||
      backend.isAuthorizedNativeAuthRequest(req.url);
    return isOwnApi
      ? throwError(() => new RuntimePlatformUnknownError())
      : next(req);
  }
  if (!backend.isAuthorizedApiRequest(req.url) && !backend.isAuthorizedNativeAuthRequest(req.url)) {
    return next(req);
  }

  const auth = inject(AuthService);
  const metadata = inject(NativeMetadataService);
  const pathname = requestPath(req.url);
  const skipGlobalNativeAuthHandler = req.context.get(SKIP_GLOBAL_NATIVE_AUTH_HANDLER);
  const metadataFlight: Observable<NativeAppMetadata | null> =
    pathname === NATIVE_LOGOUT_PATH ? of(null) : from(metadata.current());

  return metadataFlight.pipe(
    switchMap((currentMetadata) => {
      let headers = req.headers;
      if (currentMetadata) {
        headers = headers
          .set('X-Native-Platform', currentMetadata.platform)
          .set('X-Native-App-Build', String(currentMetadata.appBuild))
          .set('X-Native-App-Version', currentMetadata.appVersion);
      }

      const authSnapshot = auth.nativeRequestAuthSnapshot(pathname);
      const token = authSnapshot?.token ?? null;
      if (token && pathname !== NATIVE_LOGIN_PATH) {
        headers = headers.set('Authorization', `Bearer ${token}`);
      }

      return next(req.clone({ headers, withCredentials: false })).pipe(
        catchError((error: unknown) => {
          if (!(error instanceof HttpErrorResponse)) return throwError(() => error);
          if (error.status === 426 && !skipGlobalNativeAuthHandler) {
            if (isBlobLike(error.error)) {
              return from(auth.handleNative426()).pipe(switchMap(() => throwError(() => error)));
            }
            return trustedNativeErrorCode(error.error).pipe(
              switchMap((code) => code === 'NATIVE_APP_UPGRADE_REQUIRED'
                ? from(auth.handleNative426()).pipe(switchMap(() => throwError(() => error)))
                : throwError(() => error)),
            );
          }
          if (
            error.status === 401 &&
            !skipGlobalNativeAuthHandler &&
            pathname !== NATIVE_LOGIN_PATH &&
            pathname !== NATIVE_LOGOUT_PATH
          ) {
            return from(auth.handleNative401(authSnapshot?.generation)).pipe(
              switchMap(() => throwError(() => error)),
            );
          }
          return throwError(() => error);
        }),
      );
    }),
  );
};
