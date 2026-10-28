import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import './verify-android-branding.mjs';
import mobile from './mobile-build-config.cjs';
import { verifyNativeArtifact } from './native-artifact.mjs';

const frontRoot = fileURLToPath(new URL('../', import.meta.url));
const selection = mobile.mobileSelection();
const distRoot = join(frontRoot, selection.webDir);
const nativeRoot = join(frontRoot, 'android', 'app', 'src', 'main', 'assets', 'public');
const capacitorOnlyAssets = new Set(['cordova.js', 'cordova_plugins.js']);
await verifyNativeArtifact(nativeRoot, selection, JSON.parse(await readFile(join(frontRoot, 'android/app/src/main/assets/capacitor.config.json'), 'utf8')));

async function filesBelow(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(current, entry.name);
    return entry.isDirectory() ? filesBelow(root, path) : [relative(root, path).replaceAll('\\', '/')];
  }));
  return files.flat().sort();
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

const [distFiles, nativeFiles] = await Promise.all([filesBelow(distRoot), filesBelow(nativeRoot)]);
const copiedFiles = nativeFiles.filter((file) => !capacitorOnlyAssets.has(file));
const missing = distFiles.filter((file) => !copiedFiles.includes(file));
const unexpected = copiedFiles.filter((file) => !distFiles.includes(file));
const changed = [];

for (const file of distFiles.filter((candidate) => copiedFiles.includes(candidate))) {
  const [distHash, nativeHash] = await Promise.all([
    sha256(join(distRoot, file)),
    sha256(join(nativeRoot, file)),
  ]);
  if (distHash !== nativeHash) changed.push(file);
}

if (missing.length || unexpected.length || changed.length) {
  throw new Error([
    'Los assets Android no corresponden al build native actual.',
    missing.length ? `Faltantes: ${missing.join(', ')}` : '',
    unexpected.length ? `Inesperados: ${unexpected.join(', ')}` : '',
    changed.length ? `Hash diferente: ${changed.join(', ')}` : '',
  ].filter(Boolean).join('\n'));
}

for (const required of ['index.html', 'branding/rs_splash_piloto.png']) {
  if (!distFiles.includes(required)) throw new Error(`Falta el asset requerido ${required}.`);
}
const splashSourceHash = await sha256(join(frontRoot, 'branding', 'rs_splash_piloto.png'));
if (await sha256(join(nativeRoot, 'branding', 'rs_splash_piloto.png')) !== splashSourceHash) {
  throw new Error('El splash copiado al arranque nativo no coincide con el original.');
}
const nativeIndex = await readFile(join(nativeRoot, 'index.html'), 'utf8');
if (!nativeIndex.includes('src="branding/rs_splash_piloto.png"') ||
    !nativeIndex.includes('background-size:cover') && !nativeIndex.includes('center/cover no-repeat') ||
    !nativeIndex.includes('object-position:center top') || nativeIndex.includes('background:white')) {
  throw new Error('El índice nativo no muestra el splash durante el arranque.');
}
if (!distFiles.some((file) => /^main(?:-[^.]+)?\.js$/.test(file))) {
  throw new Error('Falta el bundle main*.js en los assets nativos.');
}
if (!distFiles.some((file) => /^styles(?:-[^.]+)?\.css$/.test(file))) {
  throw new Error('Falta el bundle styles*.css en los assets nativos.');
}

console.log(`Assets Capacitor verificados: ${distFiles.length} archivos idénticos por SHA-256.`);
