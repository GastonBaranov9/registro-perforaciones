import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import mobile from './mobile-build-config.cjs';
import { deriveNativeWebsocketOrigin, validateNativeBackendOrigin } from './native-backend-config.mjs';

const manifestName = 'rsp-native-build.json';
async function inventory(root, directory = root, includeCapacitor = false) {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Assets con symlinks no permitidos.');
    const full = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await inventory(root, full, includeCapacitor));
    else {
      const name = relative(root, full).replaceAll('\\', '/');
      if (name !== manifestName && (includeCapacitor || !['cordova.js', 'cordova_plugins.js'].includes(name))) {
        files[name] = createHash('sha256').update(await readFile(full)).digest('hex');
      }
    }
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

export function nativeCsp(origin) {
  return [
    "default-src 'self' data: blob:", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${origin}`, "font-src 'self' data:",
    `connect-src 'self' ${origin} ${deriveNativeWebsocketOrigin(origin)}`,
    "object-src 'none'", "base-uri 'self'", "frame-src 'none'",
  ].join('; ');
}

function assertCsp(html, origin) {
  // Inspect the actual meta element, not a substring in a comment or a broader policy.
  const markup = html.replace(/<!--[\s\S]*?-->/g, '');
  const policies = [...markup.matchAll(/<meta\b[^>]*>/gi)].filter(([tag]) =>
    /\bhttp-equiv\s*=\s*(["'])Content-Security-Policy\1/i.test(tag));
  const content = policies[0]?.[0].match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (policies.length !== 1 || content !== nativeCsp(origin)) throw new Error('CSP no corresponde al backend.');
}

export async function recordNativeArtifact(root, selection, mode, origin) {
  const manifest = { variant: selection.variant, appId: selection.appId, mode, origin,
    websocketOrigin: deriveNativeWebsocketOrigin(origin), files: await inventory(root) };
  await writeFile(join(root, manifestName), JSON.stringify(manifest, null, 2) + '\n');
  await verifyNativeArtifact(root, selection);
}

export async function verifyNativeArtifact(root, selection, capacitorConfig) {
  const manifest = JSON.parse(await readFile(join(root, manifestName), 'utf8'));
  if (selection.variant === 'lab') mobile.labOrigin(manifest.origin);
  else validateNativeBackendOrigin(manifest.origin, manifest.mode);
  if (manifest.variant !== selection.variant || manifest.appId !== selection.appId ||
      (selection.variant === 'lab' && (manifest.origin !== selection.origin || manifest.mode !== 'lab')) ||
      (selection.variant === 'production' && !['development', 'production'].includes(manifest.mode)) ||
      manifest.websocketOrigin !== deriveNativeWebsocketOrigin(manifest.origin)) {
    throw new Error('Identidad/backend del artefacto mezclados.');
  }
  if (capacitorConfig && (capacitorConfig.appId !== selection.appId || capacitorConfig.appName !== selection.appName ||
      capacitorConfig.server || capacitorConfig.android?.allowMixedContent)) {
    throw new Error('Capacitor incompatible con el artefacto o red insegura.');
  }
  const files = await inventory(root);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files)) throw new Error('Assets alterados o incompletos.');
  const html = await readFile(join(root, 'index.html'), 'utf8');
  assertCsp(html, manifest.origin);
  if (selection.variant === 'lab') {
    if (!html.includes('ENTORNO DE PRUEBAS')) throw new Error('Falta identificación de laboratorio.');
    let runtimeOrigin = false;
    // Capacitor generates these two Cordova files after the Angular build. Scan them too.
    const allFiles = await inventory(root, root, true);
    for (const name of Object.keys(allFiles).filter(name => /\.(html|js|json|css)$/.test(name))) {
      const content = await readFile(join(root, name), 'utf8');
      if (mobile.FORBIDDEN_HOSTS.some(host => content.toLowerCase().includes(host))) throw new Error(`Destino productivo en asset: ${name}`);
      if (name.endsWith('.js') && content.includes(manifest.origin)) runtimeOrigin = true;
    }
    if (!runtimeOrigin) throw new Error('No se encontró backend autorizado en JavaScript compilado.');
  }
  return manifest;
}
