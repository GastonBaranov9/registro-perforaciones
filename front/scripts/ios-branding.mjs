import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inflateSync, crc32 } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { DOMParser } from '@xmldom/xmldom';

const front = dirname(dirname(fileURLToPath(import.meta.url)));
const assets = 'App/App/Assets.xcassets';
export const ICON = `${assets}/AppIcon.appiconset/rs-icon-1024.png`;
export const SPLASH = `${assets}/Splash.imageset/rs-splash.png`;
export const LAUNCH = 'App/App/Base.lproj/LaunchScreen.storyboard';
const iconCatalog = `${assets}/AppIcon.appiconset/Contents.json`;
const splashCatalog = `${assets}/Splash.imageset/Contents.json`;
const sources = {
  'branding/rs_icono_piloto.png': '8b5bcda23d1647dac485d7f6887750cac343c743ef9a59e2843b7a729d478ad7',
  'branding/rs_splash_piloto.png': '08aeb74c564fd8130dfe6f59e628a0e3757e6e8c255529b08c3fd593aa393f87',
};
const background = [6, 148, 252]; // Original splash pixel (800, 700), not a new brand color.
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const check = (ok, message) => { if (!ok) throw new Error(message); };
const json = value => JSON.stringify(value, null, 2) + '\n';

function chunk(type, data) {
  const buffer = Buffer.alloc(data.length + 12);
  buffer.writeUInt32BE(data.length); buffer.write(type, 4, 4, 'ascii'); data.copy(buffer, 8);
  buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4);
  return buffer;
}
// Deliberately limited to the approved non-interlaced 8-bit RGB originals/outputs.
// This validates PNG integrity; resizing uses the Windows image codec, not this parser.
export function inspectPng(bytes, requireSrgb = false) {
  check(bytes.subarray(0, 8).equals(signature), 'Firma PNG incorrecta.');
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    check(offset + 12 <= bytes.length, 'PNG truncado.');
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    check(end <= bytes.length, 'Chunk PNG truncado.');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    check(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'CRC PNG incorrecto.');
    chunks.push({ type, data: bytes.subarray(offset + 8, end - 4) }); offset = end;
  }
  check(chunks[0]?.type === 'IHDR' && chunks[0].data.length === 13 && chunks.at(-1)?.type === 'IEND' &&
    chunks.at(-1).data.length === 0 && chunks.filter(c => c.type === 'IHDR' || c.type === 'IEND').length === 2, 'Estructura PNG incorrecta.');
  const h = chunks[0].data, width = h.readUInt32BE(0), height = h.readUInt32BE(4);
  check(width > 0 && height > 0 && width <= 4096 && height <= 4096, 'Dimensiones PNG fuera de límite.');
  check(h[8] === 8 && h[9] === 2 && h[10] === 0 && h[11] === 0 && h[12] === 0 && !chunks.some(c => c.type === 'tRNS'), 'Se requiere RGB 8-bit sin alfa ni transparencia.');
  const idat = Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
  const stride = width * 3 + 1, raw = inflateSync(idat, { maxOutputLength: stride * height });
  check(raw.length === stride * height, 'Raster PNG incompleto.');
  for (let y = 0; y < height; y++) check(raw[y * stride] <= 4, 'Filtro PNG inválido.');
  if (requireSrgb) {
    check(chunks.filter(c => c.type === 'sRGB').length === 1 && chunks.find(c => c.type === 'sRGB').data.equals(Buffer.from([0])), 'Falta sRGB explícito.');
    check(chunks.every(c => ['IHDR', 'sRGB', 'IDAT', 'IEND'].includes(c.type)), 'Metadatos PNG inesperados.');
  }
  return { width, height, chunks, idat };
}
function srgbPng(bytes) {
  const png = inspectPng(bytes);
  check(!png.chunks.some(c => c.type === 'iCCP'), 'Perfil ICC no evaluado: no asignar sRGB sin conversión.');
  // Approved originals are untagged RGB. Preserve their RGB values; remove ancillary
  // provenance/encoder metadata and explicitly tag sRGB. No color retouching.
  return Buffer.concat([signature, chunk('IHDR', png.chunks[0].data), chunk('sRGB', Buffer.from([0])),
    chunk('IDAT', png.idat), chunk('IEND', Buffer.alloc(0))]);
}
const catalogs = {
  [iconCatalog]: { images: [{ filename: 'rs-icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } },
  [splashCatalog]: { images: [{ filename: 'rs-splash.png', idiom: 'universal', scale: '1x' }], info: { author: 'xcode', version: 1 } },
};
function launchScreen() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="17132" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <device id="retina4_7" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="17105"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController id="01J-lp-oVM" sceneMemberID="viewController">
                    <view key="view" contentMode="scaleToFill" id="rsp-root">
                        <rect key="frame" x="0.0" y="0.0" width="375" height="667"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <subviews>
                            <imageView clipsSubviews="YES" userInteractionEnabled="NO" contentMode="scaleAspectFit" image="Splash" translatesAutoresizingMaskIntoConstraints="NO" id="rsp-splash">
                                <rect key="frame" x="0.0" y="20" width="375" height="647"/>
                            </imageView>
                        </subviews>
                        <viewLayoutGuide key="safeArea" id="rsp-safe"/>
                        <color key="backgroundColor" red="${background[0] / 255}" green="${background[1] / 255}" blue="${background[2] / 255}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                        <constraints>
                            <constraint firstItem="rsp-splash" firstAttribute="top" secondItem="rsp-safe" secondAttribute="top" id="rsp-top"/>
                            <constraint firstItem="rsp-splash" firstAttribute="bottom" secondItem="rsp-safe" secondAttribute="bottom" id="rsp-bottom"/>
                            <constraint firstItem="rsp-splash" firstAttribute="leading" secondItem="rsp-safe" secondAttribute="leading" id="rsp-leading"/>
                            <constraint firstItem="rsp-splash" firstAttribute="trailing" secondItem="rsp-safe" secondAttribute="trailing" id="rsp-trailing"/>
                        </constraints>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
        </scene>
    </scenes>
    <resources><image name="Splash" width="941" height="1672"/></resources>
</document>
`;
}
export function verifyLaunch(xml) {
  const errors = [];
  const doc = new DOMParser({ onError: (level, message) => errors.push(message) }).parseFromString(xml, 'application/xml');
  check(!errors.length && doc.documentElement.getAttribute('launchScreen') === 'YES', 'Storyboard inválido.');
  const images = Array.from(doc.getElementsByTagName('imageView'));
  check(images.length === 1 && images[0].getAttribute('contentMode') === 'scaleAspectFit' && images[0].getAttribute('image') === 'Splash', 'Splash debe conservar la imagen completa con aspect fit.');
  // Exact generated layout also rejects changed colors, unsafe area, stretching,
  // added runtime code, dynamic appearance or conflicting constraints.
  check(xml.replaceAll('\r\n', '\n') === launchScreen(), 'LaunchScreen difiere de la configuración reproducible.');
}
async function approvedSources(root) {
  const android = JSON.parse(await readFile(join(root, 'branding/android-assets.json'), 'utf8'));
  for (const [name, expected] of Object.entries(sources)) {
    check(android[name] === expected && hash(await readFile(join(root, name))) === expected, 'Original de marca no aprobado: ' + name);
  }
}
export async function generateIosBranding(root = front, ios = join(root, 'ios')) {
  check(process.platform === 'win32', 'Regeneración: Windows PowerShell 5.1/System.Drawing; macOS verifica los PNG versionados.');
  await approvedSources(root);
  const originalIcon = inspectPng(await readFile(join(root, 'branding/rs_icono_piloto.png')));
  check(originalIcon.width === originalIcon.height && originalIcon.width >= 1024, 'Ícono original insuficiente.');
  const script = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$source = [Drawing.Bitmap]::new($env:RSP_IOS_BRAND_ICON)
$bitmap = [Drawing.Bitmap]::new(1024,1024,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$attributes = [Drawing.Imaging.ImageAttributes]::new()
$stream = [IO.MemoryStream]::new()
try {
  $attributes.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
  $graphics.DrawImage($source,[Drawing.Rectangle]::new(0,0,1024,1024),0,0,$source.Width,$source.Height,[Drawing.GraphicsUnit]::Pixel,$attributes)
  $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
  [Console]::Write([Convert]::ToBase64String($stream.ToArray()))
} finally { $stream.Dispose(); $attributes.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $source.Dispose() }`;
  const resized = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, RSP_IOS_BRAND_ICON: join(root, 'branding/rs_icono_piloto.png') },
  });
  const outputs = new Map([[ICON, srgbPng(Buffer.from(resized.trim(), 'base64'))],
    [SPLASH, srgbPng(await readFile(join(root, 'branding/rs_splash_piloto.png')))], [LAUNCH, Buffer.from(launchScreen())]]);
  for (const [name, catalog] of Object.entries(catalogs)) outputs.set(name, Buffer.from(json(catalog)));
  const manifest = { version: 1, sources, background: { rgb: background, sourcePixel: [800, 700] },
    outputs: Object.fromEntries([...outputs].map(([name, bytes]) => [name, hash(bytes)])) };
  outputs.set('branding.json', Buffer.from(json(manifest)));
  for (const [name, bytes] of outputs) { await mkdir(dirname(join(ios, name)), { recursive: true }); await writeFile(join(ios, name), bytes); }
  return manifest;
}
export async function verifyIosBranding(root = front, ios = join(root, 'ios')) {
  await approvedSources(root);
  const manifest = JSON.parse(await readFile(join(ios, 'branding.json'), 'utf8'));
  check(manifest.version === 1 && json(manifest.sources) === json(sources) && json(manifest.background) === json({ rgb: background, sourcePixel: [800, 700] }), 'Manifest de marca incompatible.');
  check(json(Object.keys(manifest.outputs).sort()) === json([ICON, SPLASH, LAUNCH, iconCatalog, splashCatalog].sort()), 'Inventario de marca inesperado.');
  for (const [name, expected] of Object.entries(manifest.outputs)) check(hash(await readFile(join(ios, name))) === expected, 'Hash de branding incorrecto: ' + name);
  const icon = inspectPng(await readFile(join(ios, ICON)), true), splash = inspectPng(await readFile(join(ios, SPLASH)), true);
  check(icon.width === 1024 && icon.height === 1024 && splash.width === 941 && splash.height === 1672, 'Dimensiones de branding incorrectas.');
  check(splash.idat.equals(inspectPng(await readFile(join(root, 'branding/rs_splash_piloto.png'))).idat), 'Los píxeles del splash original cambiaron.');
  for (const [name, expected] of Object.entries(catalogs)) {
    check(json(JSON.parse(await readFile(join(ios, name), 'utf8'))) === json(expected), 'Catálogo incorrecto: ' + name);
    const files = await readdir(dirname(join(ios, name)));
    check(json(files.sort()) === json(['Contents.json', expected.images[0].filename].sort()), 'Recursos genéricos o duplicados en catálogo.');
  }
  verifyLaunch(await readFile(join(ios, LAUNCH), 'utf8'));
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  check(process.argv.length === 3 && ['--generate', '--verify'].includes(process.argv[2]), 'Usar --generate o --verify.');
  if (process.argv[2] === '--generate') await generateIosBranding();
  else await verifyIosBranding();
  console.log(process.argv[2] === '--generate' ? 'IOS_BRANDING_GENERATED' : 'IOS_BRANDING_VERIFIED');
}
