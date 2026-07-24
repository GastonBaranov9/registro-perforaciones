import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as fs from "fs/promises";
import type { ReportePozo } from "../services/generar-informe-consultas.ts";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

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
  let y = pageHeight - marginTop;

  let image: any | null = null;
  let imgWidth = 0;
  let imgHeight = 0;

  if (reporte.foto_url) {
    try {
      let rel = reporte.foto_url;
      rel = rel.replace(/^https?:\/\/[^/]+/, "");
      rel = rel.replace(/^\/api\//, "/");
      rel = rel.replace(/^\//, "");
      rel = rel.replace(/^public\//, "");

      const filePath = path.join(PUBLIC_DIR, rel);
      console.log("foto_url:", reporte.foto_url);
      console.log("filePath final:", filePath);

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
        console.log("Formato de imagen no soportado:", filePath);
      }

      if (image) {
        imgWidth = 180;
        imgHeight = (image.height / image.width) * imgWidth;
      }
    } catch (e) {
      console.log("No se pudo cargar foto:", e);
    }
  }

  const nuevaPagina = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - marginTop;
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

  const drawLine = (label: string, value?: string | number | null) => {
    const safeVal =
      value === null || value === undefined || value === ""
        ? "No especificado"
        : String(value);
    const color =
      safeVal === "No especificado" ? rgb(0.5, 0.5, 0.5) : rgb(0, 0, 0);

    page.drawText(`${label}: `, {
      x: marginX,
      y,
      size: 11,
      font: bold,
      color: rgb(0, 0, 0),
    });
    page.drawText(safeVal, {
      x: marginX + 120,
      y,
      size: 11,
      font,
      color,
    });
    y -= 16;
  };

  drawLine("Ubicación", reporte.sitio);
  drawLine("Propietario", reporte.propietario);
  drawLine("Empresa", reporte.empresa);
  drawLine("Perforador", reporte.perforador);
  drawLine("Fecha inicio", reporte.fecha_inicio);
  drawLine("Fecha fin", reporte.fecha_fin);

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
    if (y < marginBottom + 50) {
      nuevaPagina();
      y -= 20;
    }
    page.drawText(`${fila.desde_m}`, { x: colX[0], y, size: 10, font });
    page.drawText(`${fila.hasta_m}`, { x: colX[1], y, size: 10, font });
    page.drawText(`${fila.material}`, { x: colX[2], y, size: 10, font });
    y -= 14;
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
      y -= 14;
    }
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

  const fecha = new Date().toLocaleDateString("es-UY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  if (image) {
    if (y - imgHeight < marginBottom + 40) {
      nuevaPagina();
    }

    page.drawText("Fotografía de perforación", {
      x: marginX,
      y,
      size: 13,
      font: bold,
      color: rgb(0, 0.2, 0.5),
    });
    y -= 20;

    page.drawImage(image, {
      x: marginX,
      y: y - imgHeight,
      width: imgWidth,
      height: imgHeight,
    });

    y -= imgHeight + 20;
  }

  page.drawText(`Generado el ${fecha}`, {
    x: marginX,
    y: marginBottom - 10,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  return doc;
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
