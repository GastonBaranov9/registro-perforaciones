import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import * as fs from "fs/promises";
import type { ReportePozo } from "../services/generar-informe-consultas.ts";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import {
  crearPerfilLitologico,
  dibujarPerfilLitologico,
} from "./perfil-litologico.ts";
import { formatearFechaCalendario } from "../utils/fechas.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

export async function crearPDF(reporte: ReportePozo, pozoId: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 50;
  const marginTop = 60;
  const marginBottom = 60;
  const pageWidth = 595.28;
  const pageHeight = 841.89;

  let page = doc.addPage([pageWidth, pageHeight]);
  const portada = page;
  let y = pageHeight - marginTop;

  let image: PDFImage | null = null;

  if (reporte.foto_url) {
    try {
      const archivos = await fs.readdir(PUBLIC_DIR);
      const nombre = archivos.find((archivo) =>
        /^pozo-\d+\.(?:jpe?g|png)$/i.test(archivo) && archivo.startsWith(`pozo-${pozoId}.`),
      );
      if (!nombre) throw new Error("La referencia de foto no tiene un archivo asociado");
      const filePath = path.join(PUBLIC_DIR, nombre);

      await fs.access(filePath);
      const imgBytes = await fs.readFile(filePath);

      const isJpeg = imgBytes[0] === 0xff && imgBytes[1] === 0xd8;
      const isPng =
        imgBytes[0] === 0x89 &&
        imgBytes[1] === 0x50 &&
        imgBytes[2] === 0x4e &&
        imgBytes[3] === 0x47;

      if (isPng) {
        image = await doc.embedPng(imgBytes);
      } else if (isJpeg) {
        image = await doc.embedJpg(imgBytes);
      } else {
        throw new Error("Formato de fotografía no soportado");
      }

    } catch (error) {
      console.warn("No se pudo incorporar la fotografía referenciada al PDF", error);
    }
  }

  const nuevaPagina = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - marginTop;
    page.drawText("Informe de Perforación", { x: marginX, y: pageHeight - 38, size: 9, font: bold, color: rgb(0, 0.2, 0.5) });
    page.drawText(`Pozo ${pozoId}`, { x: pageWidth - marginX - 55, y: pageHeight - 38, size: 8.5, font });
    page.drawLine({ start: { x: marginX, y: pageHeight - 45 }, end: { x: pageWidth - marginX, y: pageHeight - 45 }, thickness: 0.5, color: rgb(0.6, 0.65, 0.72) });
    y -= 6;
  };

  page.drawText("Informe de Perforación", {
    x: marginX,
    y,
    size: 20,
    font: bold,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 10;
  page.drawLine({
    start: { x: marginX, y },
    end: { x: pageWidth - marginX, y },
    thickness: 1,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 30;

  page.drawText(`Pozo Nº ${pozoId}`, {
    x: marginX,
    y,
    size: 14,
    font: bold,
    color: rgb(0, 0, 0),
  });
  y -= 20;

  const fotoTop = y + 8;
  const fotoBottom = fotoTop - 218;
  if (image) {
    const xFoto = 365;
    const anchoCaja = pageWidth - marginX - xFoto;
    const altoCaja = 218;
    page.drawRectangle({ x: xFoto, y: fotoBottom, width: anchoCaja, height: altoCaja, color: rgb(0.98, 0.985, 0.99), borderColor: rgb(0.55, 0.62, 0.7), borderWidth: 0.8 });
    const anchoUtil = anchoCaja - 16;
    const altoUtil = altoCaja - 32;
    const escala = Math.min(anchoUtil / image.width, altoUtil / image.height);
    const ancho = image.width * escala;
    const alto = image.height * escala;
    page.drawImage(image, { x: xFoto + (anchoCaja - ancho) / 2, y: fotoBottom + 24 + (altoUtil - alto) / 2, width: ancho, height: alto });
    page.drawText("Fotografía de la perforación", { x: xFoto + 8, y: fotoBottom + 9, size: 7.5, font, color: rgb(0.35, 0.4, 0.45) });
  }

  const drawLine = (label: string, value?: string | number | null) => {
    const safeVal =
      value === null || value === undefined || value === ""
        ? "No especificado"
        : String(value);
    const color =
      safeVal === "No especificado" ? rgb(0.5, 0.5, 0.5) : rgb(0, 0, 0);

    let anchoValor = image && page === portada && y > fotoBottom
      ? 175
      : pageWidth - marginX * 2 - 120;
    let lineas = envolverTextoPdf(safeVal, font, 10, anchoValor);
    if (y - Math.max(16, lineas.length * 11 + 3) < marginBottom) {
      nuevaPagina();
      anchoValor = pageWidth - marginX * 2 - 120;
      lineas = envolverTextoPdf(safeVal, font, 10, anchoValor);
    }

    let primeraLinea = true;
    while (lineas.length) {
      if (y < marginBottom + 16) nuevaPagina();
      page.drawText(primeraLinea ? `${label}: ` : `${label} (cont.): `, {
        x: marginX,
        y,
        size: 11,
        font: bold,
        color: rgb(0, 0, 0),
      });
      const disponibles = Math.max(1, Math.floor((y - marginBottom) / 11));
      const bloque = lineas.splice(0, disponibles);
      bloque.forEach((linea, indice) => page.drawText(linea, { x: marginX + 120, y: y - indice * 11, size: 10, font, color }));
      y -= Math.max(16, bloque.length * 11 + 3);
      primeraLinea = false;
      if (lineas.length) nuevaPagina();
    }
  };

  drawLine("Ubicación", reporte.sitio);
  drawLine("Propietario", reporte.propietario);
  drawLine("Empresa", reporte.empresa);
  drawLine("Perforador", reporte.perforador);
  drawLine("Fecha de inicio", formatearFechaCalendario(reporte.fecha_inicio));
  drawLine("Fecha de finalización", formatearFechaCalendario(reporte.fecha_fin));

  if (image) y = Math.min(y, fotoBottom - 18);
  y -= 15;

  page.drawText("Características Constructivas", {
    x: marginX,
    y,
    size: 13,
    font: bold,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 18;

  drawLine("Profundidad final (m)", reporte.profundidad_final_m);
  drawLine("Nivel estático (m)", reporte.nivel_estatico_m);
  drawLine("Nivel dinámico (m)", reporte.nivel_dinamico_m);
  drawLine("Caudal estimado (l/h)", reporte.caudal_estimado_lh);
  drawLine("Método sedimentario", reporte.metodo_sedimentario);
  drawLine("Método rocoso", reporte.metodo_rocoso);
  drawLine("Cementación", reporte.cementacion);
  drawLine("Desarrollo", reporte.desarrollo);

  y -= 25;
  if (y < marginBottom + 40) nuevaPagina();

  page.drawText("Intervalos Litológicos", {
    x: marginX,
    y,
    size: 13,
    font: bold,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 20;

  const colX = [marginX, marginX + 100, marginX + 200, marginX + 400];

  page.drawText("Desde (m)", { x: colX[0], y, size: 11, font: bold });
  page.drawText("Hasta (m)", { x: colX[1], y, size: 11, font: bold });
  page.drawText("Material", { x: colX[2], y, size: 11, font: bold });
  y -= 12;

  page.drawLine({
    start: { x: marginX, y },
    end: { x: pageWidth - marginX, y },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  y -= 10;

  const litologia = reporte.litologia ?? [];

  for (const fila of litologia) {
    const lineasMaterial = envolverTextoPdf(String(fila.material), font, 10, pageWidth - colX[2] - marginX);
    const altoFila = Math.max(14, lineasMaterial.length * 12);
    if (y < marginBottom + altoFila + 20) {
      nuevaPagina();
      y -= 20;
    }
    page.drawText(`${fila.desde_m}`, { x: colX[0], y, size: 10, font });
    page.drawText(`${fila.hasta_m}`, { x: colX[1], y, size: 10, font });
    lineasMaterial.forEach((linea, indice) => page.drawText(linea, { x: colX[2], y: y - indice * 12, size: 10, font }));
    y -= altoFila;
  }

  y -= 20;

  page.drawText("Intervalos de Diámetro de Perforación", {
    x: marginX,
    y,
    size: 13,
    font: bold,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 20;

  page.drawText("Desde (m)", { x: colX[0], y, size: 11, font: bold });
  page.drawText("Hasta (m)", { x: colX[1], y, size: 11, font: bold });
  page.drawText("Diámetro (pulg)", { x: colX[2], y, size: 11, font: bold });
  page.drawText("Material", { x: colX[3], y, size: 11, font: bold });
  y -= 12;

  page.drawLine({
    start: { x: marginX, y },
    end: { x: pageWidth - marginX, y },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  y -= 10;

  const diametros = reporte.diametros ?? [];
  if (diametros.length === 0) {
    page.drawText("Sin registros.", { x: marginX, y, size: 10, font });
    y -= 14;
  } else {
    for (const fila of diametros) {
      if (y < marginBottom + 50) {
        nuevaPagina();
        y -= 20;
      }
      page.drawText(`${fila.desde_m}`, { x: colX[0], y, size: 10, font });
      page.drawText(`${fila.hasta_m}`, { x: colX[1], y, size: 10, font });
      page.drawText(`${fila.diametro_pulg}`, {
        x: colX[2],
        y,
        size: 10,
        font,
      });
      page.drawText(fila.material_tuberia ?? "No especificado", { x: colX[3], y, size: 10, font });
      y -= 14;
    }
  }

  y -= 20;

  page.drawText("Intervalos de filtro", { x: marginX, y, size: 13, font: bold, color: rgb(0, 0.2, 0.5) });
  y -= 20;
  page.drawText("Desde (m)", { x: colX[0], y, size: 10, font: bold });
  page.drawText("Hasta (m)", { x: colX[1], y, size: 10, font: bold });
  page.drawText("Diámetro (pulg)", { x: colX[2], y, size: 10, font: bold });
  page.drawText("Material", { x: colX[3], y, size: 10, font: bold }); y -= 18;
  const filtros = reporte.filtros ?? [];
  if (!filtros.length) { page.drawText("Sin registros.", { x: marginX, y, size: 10, font }); y -= 14; }
  for (const fila of filtros) {
    if (y < marginBottom + 35) nuevaPagina();
    page.drawText(String(fila.desde_m),{x:colX[0],y,size:10,font}); page.drawText(String(fila.hasta_m),{x:colX[1],y,size:10,font});
    page.drawText(String(fila.diametro_pulg),{x:colX[2],y,size:10,font}); page.drawText(fila.material_tuberia,{x:colX[3],y,size:10,font}); y-=14;
  }
  y -= 20;

  page.drawText("Niveles de Aporte", {
    x: marginX,
    y,
    size: 13,
    font: bold,
    color: rgb(0, 0.2, 0.5),
  });
  y -= 18;

  const niveles = reporte.niveles_aporte ?? [];
  if (niveles.length === 0) {
    page.drawText("Sin registros.", { x: marginX, y, size: 10, font });
    y -= 14;
  } else {
    for (const n of niveles) {
      if (y < marginBottom + 50) {
        nuevaPagina();
        y -= 20;
      }
      page.drawText(`• ${n.profundidad_m} m`, {
        x: marginX,
        y,
        size: 10,
        font,
      });
      y -= 14;
    }
  }

  const perfilLitologico = crearPerfilLitologico(
    litologia,
    reporte.profundidad_final_m,
    reporte.niveles_aporte,
    reporte.diametros,
    reporte.filtros ?? [],
  );
  if (perfilLitologico) {
    dibujarPerfilLitologico(doc, perfilLitologico, font, bold);
  }

  return doc;
}

function envolverTextoPdf(texto: string, font: PDFFont, tamano: number, ancho: number) {
  const seguro = texto.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
  const lineas: string[] = [];
  let actual = "";
  const palabras: string[] = [];
  for (const palabra of seguro.split(/\s+/)) {
    if (font.widthOfTextAtSize(palabra, tamano) <= ancho) {
      palabras.push(palabra);
      continue;
    }
    let fragmento = "";
    for (const caracter of palabra) {
      const candidato = fragmento + caracter;
      if (fragmento && font.widthOfTextAtSize(candidato, tamano) > ancho) {
        palabras.push(fragmento);
        fragmento = caracter;
      } else fragmento = candidato;
    }
    if (fragmento) palabras.push(fragmento);
  }
  for (const palabra of palabras) {
    const candidato = actual ? `${actual} ${palabra}` : palabra;
    if (font.widthOfTextAtSize(candidato, tamano) <= ancho) actual = candidato;
    else {
      if (actual) lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : ["Sin material"];
}

export async function generarPDF(reporte: ReportePozo, pozoId: number) {
  const doc = await crearPDF(reporte, pozoId);
  const pdfBytes = await doc.save();
  await fs.mkdir("./output", { recursive: true });
  await fs.writeFile(`./output/informe_pozo_${pozoId}.pdf`, pdfBytes);
}

export async function generarPDFBytes(
  reporte: ReportePozo,
  pozoId: number
): Promise<Uint8Array> {
  const doc = await crearPDF(reporte, pozoId);
  const pdfBytes = await doc.save();
  return pdfBytes;
}
