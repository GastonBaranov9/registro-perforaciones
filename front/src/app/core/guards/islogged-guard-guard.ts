import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from '../../shared/services/auth-service/auth.service';
import { MainStore } from '../../shared/services/mainstore-service/main.store';
import { RuntimePlatformService } from '../native/runtime-platform.service';

function loginRedirect(router: Router, state: RouterStateSnapshot): UrlTree {
  return router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });
}

function nativeStateRedirect(auth: AuthService, router: Router, state: RouterStateSnapshot): true | UrlTree {
  switch (auth.state()) {
    case 'authenticated':
      return true;
    case 'upgrade-required':
      return router.createUrlTree(['/upgrade-required']);
    case 'offline-unverified':
      return router.createUrlTree(['/session-unavailable'], { queryParams: { reason: 'offline' } });
    case 'logout-pending':
      return router.createUrlTree(['/session-unavailable'], { queryParams: { reason: 'logout-pending' } });
    case 'client-error':
      return router.createUrlTree(['/session-unavailable'], { queryParams: { reason: 'client-error' } });
    default:
      return loginRedirect(router, state);
  }
}

async function requireNativeSession(
  auth: AuthService,
  router: Router,
  state: RouterStateSnapshot,
): Promise<true | UrlTree> {
  await auth.bootstrap();
  return nativeStateRedirect(auth, router, state);
}

export const nativeSessionGuard: CanActivateFn = (_route, state) => {
  if (!inject(RuntimePlatformService).isNative()) return true;
  const auth = inject(AuthService);
  return requireNativeSession(auth, inject(Router), state);
};

export const isloggedGuard: CanActivateFn = (_route, state) => {
  const mainStore = inject(MainStore);
  const router = inject(Router);
  if (inject(RuntimePlatformService).isNative()) {
    return requireNativeSession(inject(AuthService), router, state);
  }
  return mainStore.user() ? true : loginRedirect(router, state);
};

function roleResult(
  roleNames: readonly string[],
  mainStore: MainStore,
  router: Router,
  state: RouterStateSnapshot,
): boolean | UrlTree {
  const permitted = mainStore.user()?.roles?.some((role) => roleNames.includes(role.nombre));
  return permitted
    ? true
    : router.createUrlTree(['/home'], { queryParams: { redirectTo: state.url } });
}

function requireRole(
  roleNames: readonly string[],
  state: RouterStateSnapshot,
): boolean | UrlTree | Promise<boolean | UrlTree> {
  const mainStore = inject(MainStore);
  const router = inject(Router);
  if (inject(RuntimePlatformService).isNative()) {
    const auth = inject(AuthService);
    return requireNativeSession(auth, router, state).then((access) =>
      access === true ? roleResult(roleNames, mainStore, router, state) : access,
    );
  }
  if (!mainStore.user()) return loginRedirect(router, state);
  return roleResult(roleNames, mainStore, router, state);
}

export const isAdminGuard: CanActivateFn = (_route, state) =>
  requireRole(['administracion'], state);

export const isPerfOrAdminGuard: CanActivateFn = (_route, state) =>
  requireRole(['perforador', 'administracion'], state);

export const isPropGuard: CanActivateFn = (_route, state) =>
  requireRole(['propietario'], state);
