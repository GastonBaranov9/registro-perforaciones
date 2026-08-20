const LOOPBACK_V4 = /^127(?:\.[0-9]{1,3}){3}$/;

export function createNativeBackendConfig(rawOrigin) {
  if (typeof rawOrigin !== 'string' || rawOrigin.length === 0) {
    throw new Error('Falta NATIVE_BACKEND_ORIGIN (ejemplo: https://app.empresa.example).');
  }
  if (rawOrigin !== rawOrigin.trim()) {
    throw new Error('NATIVE_BACKEND_ORIGIN no puede contener espacios externos.');
  }

  let url;
  try { url = new URL(rawOrigin); }
  catch { throw new Error('NATIVE_BACKEND_ORIGIN debe ser una URL absoluta valida.'); }

  if (url.protocol !== 'https:') throw new Error('NATIVE_BACKEND_ORIGIN debe usar https://.');
  if (!url.hostname) throw new Error('NATIVE_BACKEND_ORIGIN debe incluir un host explicito.');
  if (url.username || url.password) throw new Error('NATIVE_BACKEND_ORIGIN no puede incluir credenciales.');
  if (url.hash) throw new Error('NATIVE_BACKEND_ORIGIN no puede incluir fragment.');
  if (url.search) throw new Error('NATIVE_BACKEND_ORIGIN no puede incluir query string.');
  if (url.pathname !== '/') throw new Error('NATIVE_BACKEND_ORIGIN debe ser un origin, sin path.');

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '0.0.0.0' ||
    hostname === '[::]' ||
    hostname === '[::1]' ||
    LOOPBACK_V4.test(hostname)
  ) {
    throw new Error('NATIVE_BACKEND_ORIGIN no puede apuntar a localhost o loopback.');
  }

  const origin = url.origin;
  return Object.freeze({
    serverURL: `${origin}/api`,
    apiURL: `${origin}/api/`,
    wsUrl: `wss://${url.host}/ws`,
  });
}

export function renderNativeEnvironment(config) {
  return [
    '// Generado por npm run build:native. No editar ni versionar.',
    'export const environment = {',
    `  serverURL: ${JSON.stringify(config.serverURL)},`,
    `  apiURL: ${JSON.stringify(config.apiURL)},`,
    `  wsUrl: ${JSON.stringify(config.wsUrl)},`,
    '};',
    '',
  ].join('\n');
}
