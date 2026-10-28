const fs = require('node:fs');
const path = require('node:path');

const PRODUCTION_ID = 'uy.com.raulsilva.perforaciones';
const LAB_ID = `${PRODUCTION_ID}.pruebas`;
const LAB_NAME = 'Raúl Silva Perforaciones - Pruebas';
const FORBIDDEN_HOSTS = ['raulsilvaperforaciones.com', 'www.raulsilvaperforaciones.com',
  'api.raulsilvaperforaciones.com', 'app.raulsilvaperforaciones.com'];

function labOrigin(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error('Origin de laboratorio ausente.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Origin de laboratorio inválido.'); }
  const labels = url.hostname.split('.');
  const dnsHost = labels.length >= 2 && url.hostname.length <= 253 &&
    labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !/^\d+(?:\.\d+){3}$/.test(url.hostname);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || !dnsHost ||
      FORBIDDEN_HOSTS.includes(url.hostname.toLowerCase().replace(/\.$/, ''))) {
    throw new Error('Backend de laboratorio inseguro o productivo.');
  }
  return value;
}

function validateLabConfig(config, requestedOrigin) {
  if (!config || Object.keys(config).sort().join(',') !== 'allowedOrigins,appId,backendOrigin' ||
      config.appId !== LAB_ID || !Array.isArray(config.allowedOrigins) || !config.allowedOrigins.length) {
    throw new Error('Configuración de laboratorio incompleta o identidad incorrecta.');
  }
  const origins = config.allowedOrigins.map(labOrigin);
  if (new Set(origins).size !== origins.length) throw new Error('Allowlist ambigua.');
  const origin = labOrigin(config.backendOrigin);
  if (!origins.includes(origin) || (requestedOrigin !== undefined && requestedOrigin !== origin)) {
    throw new Error('Backend no autorizado o parámetros mezclados.');
  }
  return origin;
}

function mobileSelection(env = process.env) {
  const variant = env.RSP_MOBILE_VARIANT ?? 'production';
  if (!['production', 'lab'].includes(variant)) throw new Error('RSP_MOBILE_VARIANT inválida.');
  if (env.NATIVE_APP_ID !== undefined || env.NATIVE_BUILD_MODE !== undefined) throw new Error('No se permiten overrides de identidad/modo.');
  if (variant === 'production') {
    if (env.NATIVE_LAB_CONFIG) throw new Error('Configuración de laboratorio en variante productiva.');
    return { variant, appId: PRODUCTION_ID, appName: 'Raul Silva Perforaciones', webDir: 'dist/front/browser' };
  }
  if (!env.NATIVE_LAB_CONFIG || !path.isAbsolute(env.NATIVE_LAB_CONFIG)) {
    throw new Error('NATIVE_LAB_CONFIG debe señalar un archivo privado absoluto autorizado.');
  }
  const configPath = fs.realpathSync(env.NATIVE_LAB_CONFIG);
  const repository = path.resolve(__dirname, '../..');
  const relative = path.relative(repository, configPath);
  if ((!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) ||
      /rsp-pilot|rsp-private-deployment/i.test(configPath)) throw new Error('Usar configuración privada independiente fuera del repositorio.');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || env.ANDROID_STORE_FILE || env.ANDROID_STORE_PASSWORD ||
      env.ANDROID_KEY_ALIAS || env.ANDROID_KEY_PASSWORD) throw new Error('Laboratorio no admite bypass TLS ni firma de distribución.');
  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { throw new Error('No se pudo leer JSON privado de laboratorio.'); }
  const origin = validateLabConfig(config, env.NATIVE_BACKEND_ORIGIN);
  return { variant, appId: LAB_ID, appName: LAB_NAME, webDir: 'dist/mobile-lab/browser', origin };
}

module.exports = { PRODUCTION_ID, LAB_ID, LAB_NAME, FORBIDDEN_HOSTS, labOrigin, validateLabConfig, mobileSelection };
