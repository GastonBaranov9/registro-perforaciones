import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

export type NativeBuildMode = 'web' | 'development' | 'production';

// Public ingress contract. Both proxies strip /api before Fastify handles these routes.
export const NATIVE_AUTH_PUBLIC_PATHS = {
  login: '/api/auth/native/login',
  session: '/api/auth/native/session',
  logout: '/api/auth/native/logout',
  logoutAll: '/api/auth/native/logout-all',
  wsTicket: '/api/auth/native/ws-ticket',
} as const;

export type NativeAuthPublicPath =
  (typeof NATIVE_AUTH_PUBLIC_PATHS)[keyof typeof NATIVE_AUTH_PUBLIC_PATHS];

const NATIVE_AUTH_PUBLIC_PREFIX = '/api/auth/native';
const AUTHORIZED_NATIVE_AUTH_PATHS = new Set<string>(
  Object.values(NATIVE_AUTH_PUBLIC_PATHS),
);

function isNativeAuthPublicNamespace(pathname: string): boolean {
  return (
    pathname === NATIVE_AUTH_PUBLIC_PREFIX ||
    pathname.startsWith(`${NATIVE_AUTH_PUBLIC_PREFIX}/`)
  );
}

export class NativeClientConfigurationError extends Error {
  constructor() {
    super('La configuración segura de la aplicación mobile no es válida.');
    this.name = 'NativeClientConfigurationError';
  }
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

export function validateNativeBackendOrigin(
  rawOrigin: string | null,
  mode: NativeBuildMode,
): URL {
  if (mode === 'web' || !rawOrigin || rawOrigin !== rawOrigin.trim()) {
    throw new NativeClientConfigurationError();
  }

  let parsed: URL;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    throw new NativeClientConfigurationError();
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    rawOrigin !== parsed.origin
  ) {
    throw new NativeClientConfigurationError();
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    mode === 'production' &&
    (hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      isIpLiteral(hostname) ||
      /(^|[.-])(dev|stage|staging|test)([.-]|$)/i.test(hostname))
  ) {
    throw new NativeClientConfigurationError();
  }

  return parsed;
}

@Injectable({ providedIn: 'root' })
export class NativeBackendConfigService {
  private parsed?: URL;

  origin(): URL {
    this.parsed ??= validateNativeBackendOrigin(
      environment.nativeBackendOrigin,
      environment.nativeBuildMode,
    );
    return this.parsed;
  }

  isAuthorizedApiRequest(rawUrl: string): boolean {
    let requestUrl: URL;
    try {
      requestUrl = new URL(rawUrl, globalThis.location?.href ?? 'https://localhost/');
    } catch {
      return false;
    }

    const origin = this.origin();
    return (
      requestUrl.origin === origin.origin &&
      (requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/')) &&
      !isNativeAuthPublicNamespace(requestUrl.pathname)
    );
  }

  isAuthorizedNativeAuthRequest(rawUrl: string): boolean {
    let requestUrl: URL;
    try {
      requestUrl = new URL(rawUrl, globalThis.location?.href ?? 'https://localhost/');
    } catch {
      return false;
    }

    return (
      requestUrl.origin === this.origin().origin &&
      AUTHORIZED_NATIVE_AUTH_PATHS.has(requestUrl.pathname)
    );
  }

  nativeAuthUrl(path: NativeAuthPublicPath): string {
    return new URL(path, this.origin()).toString();
  }
}

export function isWebApiRequest(rawUrl: string, apiUrl: string): boolean {
  const base = globalThis.location?.href ?? 'http://localhost/';
  try {
    const request = new URL(rawUrl, base);
    const api = new URL(apiUrl, base);
    const apiPath = api.pathname.endsWith('/') ? api.pathname : `${api.pathname}/`;
    return request.origin === api.origin && request.pathname.startsWith(apiPath);
  } catch {
    return false;
  }
}
