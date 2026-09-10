const PRODUCTION_HOST_MARKER = /(^|[.-])(dev|stage|staging|test)([.-]|$)/i;
const RESERVED_PRODUCTION_SUFFIXES = ['invalid', 'example', 'localhost', 'test'];
const RESERVED_DOCUMENTATION_DOMAINS = ['example.com', 'example.net', 'example.org'];

export function isReservedProductionHostname(rawHostname) {
  const hostname = rawHostname.toLowerCase().replace(/\.$/, '');
  const belongsTo = (domain) => hostname === domain || hostname.endsWith(`.${domain}`);
  return RESERVED_PRODUCTION_SUFFIXES.some(belongsTo) ||
    RESERVED_DOCUMENTATION_DOMAINS.some(belongsTo);
}

export function validateNativeBackendOrigin(rawOrigin, mode) {
  if (!['development', 'production'].includes(mode)) {
    throw new Error('NATIVE_BUILD_MODE debe ser development o production.');
  }
  if (!rawOrigin || rawOrigin !== rawOrigin.trim()) {
    throw new Error('NATIVE_BACKEND_ORIGIN es obligatorio y debe ser un origin exacto.');
  }

  let parsed;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    throw new Error('NATIVE_BACKEND_ORIGIN no es una URL válida.');
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
    throw new Error('El backend native debe ser un origin HTTPS exacto, sin path ni credenciales.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const ipLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
  if (
    mode === 'production' &&
    (ipLiteral ||
      isReservedProductionHostname(hostname) ||
      PRODUCTION_HOST_MARKER.test(hostname))
  ) {
    throw new Error('El backend native production no puede ser local, IP, staging/test ni reservado.');
  }
  return parsed.origin;
}

export function deriveNativeWebsocketOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('El backend native WS debe derivar de un origin HTTPS válido.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    origin !== parsed.origin
  ) {
    throw new Error('El backend native WS sólo acepta un origin HTTPS exacto.');
  }
  parsed.protocol = 'wss:';
  return parsed.origin;
}

export function assertProductionAppId(capacitorSource) {
  if (/appId:\s*['"]com\.example\.app['"]/.test(capacitorSource)) {
    throw new Error('El appId placeholder bloquea un build native production.');
  }
}
