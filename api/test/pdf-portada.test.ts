import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { PDFDict, PDFName, type PDFPage } from "pdf-lib";
import { crearPDF } from "../src/pdf/pdf-generate.ts";
import type { ReportePozo } from "../src/services/generar-informe-consultas.ts";

const publicDir = path.resolve("public");

function reporte(foto: boolean, largo = false): ReportePozo {
  const texto = largo ? "Identificación técnica extensa para verificar ajuste, envoltura y continuidad ordenada del contenido sin recortes" : "Pozo ensayo";
  return { id_pozo: 90601, propietario: texto, empresa: texto, perforador: texto, sitio: largo ? `${texto} / ${texto}` : "Montevideo",
    fecha_inicio: "2026-01-01", fecha_fin: "2026-02-01", profundidad_final_m: 40, nivel_estatico_m: 5,
    nivel_dinamico_m: 9, caudal_estimado_lh: 1200, metodo_sedimentario: texto, metodo_rocoso: texto,
    cementacion: texto, desarrollo: texto, introduccion: null, nombre_archivo: null,
    foto_url: foto ? "/usuarios/1/pozos/90601/foto" : null,
    litologia: [{ desde_m: 0, hasta_m: 20, material: texto }, { desde_m: 20, hasta_m: 40, material: "Roca" }],
    diametros: [{ desde_m: 0, hasta_m: 40, diametro_pulg: 6, material_tuberia: "PVC" }], filtros: [], niveles_aporte: [{ profundidad_m: 12 }] };
}

test("foto vertical y horizontal quedan en la primera página sin crear una página vacía", async () => {
  await fs.mkdir(publicDir, { recursive: true });
  const archivo = path.join(publicDir, "pozo-90601.png");
  try {
    const sinFoto = await crearPDF(reporte(false), 90601);
    for (const [ancho, alto] of [[40, 100], [120, 45]]) {
      await fs.writeFile(archivo, png(ancho, alto));
      const doc = await crearPDF(reporte(true), 90601);
      assert.ok(doc.getPageCount() <= sinFoto.getPageCount() + 1);
      assert.ok(tieneImagen(doc.getPage(0)));
      assert.ok((await doc.save()).length > 3_000);
    }
  } finally { await fs.rm(archivo, { force: true }); }
});

test("sin foto, foto eliminada y datos largos conservan portada y perfil legibles", async () => {
  const breve = await crearPDF(reporte(false), 90601);
  const largo = await crearPDF(reporte(false, true), 90601);
  assert.equal(tieneImagen(breve.getPage(0)), false);
  assert.ok(largo.getPageCount() >= 2);
  assert.ok((await largo.save()).length > 4_000);
});

test("el PDF no agrega pie de pagina ni texto de generacion", async () => {
  const doc = await crearPDF(reporte(false), 90601);
  const contenido = Buffer.from(await doc.save({ useObjectStreams: false })).toString("latin1");
  assert.doesNotMatch(contenido, /Generado el/i);
  assert.doesNotMatch(contenido, /47656e657261646f20656c/i);
});

function tieneImagen(page: PDFPage) {
  const recursos = page.node.Resources();
  const xobjects = recursos?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  return Boolean(xobjects && xobjects.keys().length > 0);
}

function png(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    raw[offset] = 35; raw[offset + 1] = 110 + (y % 80); raw[offset + 2] = 155; raw[offset + 3] = 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function chunk(tipo: string, datos: Buffer) {
  const nombre = Buffer.from(tipo); const salida = Buffer.alloc(datos.length + 12);
  salida.writeUInt32BE(datos.length, 0); nombre.copy(salida, 4); datos.copy(salida, 8);
  salida.writeUInt32BE(crc32(Buffer.concat([nombre, datos])), datos.length + 8); return salida;
}
function crc32(datos: Buffer) {
  let crc = 0xffffffff;
  for (const byte of datos) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
