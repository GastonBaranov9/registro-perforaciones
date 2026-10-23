import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const hashes = JSON.parse(await readFile(new URL('branding/android-assets.json', root), 'utf8'));
if (Object.keys(hashes).length !== 28) throw new Error('Inventario de branding incompleto.');
for (const [path, expected] of Object.entries(hashes)) {
  const bytes = await readFile(new URL(path, root));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`Branding desactualizado: ${path}. Ejecutar generate:android-branding.`);
  if (bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error(`PNG inválido: ${path}`);
}
const styles = await readFile(new URL('android/app/src/main/res/values/styles.xml', root), 'utf8');
if (!styles.includes('@mipmap/ic_launcher_foreground') || !styles.includes('<item name="android:windowBackground">@drawable/splash</item>')) throw new Error('Tema de arranque sin branding.');
for (const icon of ['ic_launcher', 'ic_launcher_round']) {
  const xml = await readFile(new URL(`android/app/src/main/res/mipmap-anydpi-v26/${icon}.xml`, root), 'utf8');
  if (!xml.includes('@mipmap/ic_launcher_foreground')) throw new Error(`Ícono adaptativo incorrecto: ${icon}`);
}
console.log('Branding Android verificado: 2 originales y 26 derivados por SHA-256; temas e íconos adaptativos conectados.');
