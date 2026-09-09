import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

export type NativeBuildMode = 'web' | 'development' | 'production';

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
      (requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/'))
    );
  }

  isAuthorizedNativeAuthRequest(rawUrl: string): boolean {
    let requestUrl: URL;
    try {
      requestUrl = new URL(rawUrl, globalThis.location?.href ?? 'https://localhost/');
    } catch {
      return false;
    }

    return requestUrl.origin === this.origin().origin && requestUrl.pathname.startsWith('/auth/native/');
  }

  nativeAuthUrl(path: string): string {
    return new URL(path.startsWith('/') ? path : `/${path}`, this.origin()).toString();
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
