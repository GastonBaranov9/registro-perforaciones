import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";

export interface IntervaloPerfilLitologico {
  desde_m: number;
  hasta_m: number;
  material: string;
}

export interface TramoPerfilLitologico extends IntervaloPerfilLitologico {
  color: readonly [number, number, number];
}

export interface PerfilLitologico {
  profundidad_m: number;
  tramos: TramoPerfilLitologico[];
  paso_escala_m: number;
}

const PALETA: ReadonlyArray<readonly [number, number, number]> = [
  [0.85, 0.67, 0.32],
  [0.68, 0.45, 0.28],
  [0.56, 0.63, 0.68],
  [0.82, 0.76, 0.57],
  [0.48, 0.58, 0.45],
  [0.72, 0.52, 0.47],
  [0.58, 0.51, 0.68],
  [0.42, 0.65, 0.7],
];

function normalizarMaterial(material: string) {
  return material
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

export function colorDeMaterial(material: string): readonly [number, number, number] {
  const clave = normalizarMaterial(material);
  let hash = 0;
  for (const caracter of clave) hash = (hash * 31 + caracter.charCodeAt(0)) >>> 0;
  return PALETA[hash % PALETA.length];
}

export function calcularPasoEscala(profundidad_m: number) {
  if (profundidad_m <= 20) return 2;
  if (profundidad_m <= 50) return 5;
  if (profundidad_m <= 100) return 10;
  if (profundidad_m <= 250) return 25;
  if (profundidad_m <= 500) return 50;
  return 100;
}

export function crearPerfilLitologico(
  intervalos: readonly IntervaloPerfilLitologico[],
  profundidadFinal_m?: number | null,
): PerfilLitologico | null {
  const validos = [...intervalos]
    .filter(
      (tramo) =>
        Number.isFinite(tramo.desde_m) &&
        Number.isFinite(tramo.hasta_m) &&
        tramo.desde_m >= 0 &&
        tramo.hasta_m > tramo.desde_m &&
        tramo.material.trim().length > 0,
    )
    .sort((a, b) => a.desde_m - b.desde_m || a.hasta_m - b.hasta_m);

  const profundidadDeclarada =
    profundidadFinal_m != null && Number.isFinite(profundidadFinal_m) && profundidadFinal_m > 0
      ? profundidadFinal_m
      : 0;
  const profundidad_m = Math.max(profundidadDeclarada, ...validos.map((tramo) => tramo.hasta_m));
  if (profundidad_m <= 0) return null;

  return {
    profundidad_m,
    paso_escala_m: calcularPasoEscala(profundidad_m),
    tramos: validos.map((tramo) => ({ ...tramo, color: colorDeMaterial(tramo.material) })),
  };
}

function textoSeguro(texto: string) {
  return texto.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

export function dibujarPerfilLitologico(
  doc: PDFDocument,
  perfil: PerfilLitologico,
  font: PDFFont,
  bold: PDFFont,
): PDFPage {
  const page = doc.addPage([595.28, 841.89]);
  const alto = 650;
  const ySuperior = 745;
  const xColumna = 105;
  const anchoColumna = 115;
  const yDeProfundidad = (metros: number) => ySuperior - (metros / perfil.profundidad_m) * alto;

  page.drawText("Perfil litologico", {
    x: 50,
    y: 790,
    size: 18,
    font: bold,
    color: rgb(0, 0.2, 0.5),
  });
  page.drawText(`Escala proporcional - profundidad representada: ${perfil.profundidad_m} m`, {
    x: 50,
    y: 768,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });

  page.drawRectangle({
    x: xColumna,
    y: ySuperior - alto,
    width: anchoColumna,
    height: alto,
    borderWidth: 1,
    borderColor: rgb(0.15, 0.15, 0.15),
    color: rgb(0.97, 0.97, 0.97),
  });

  for (const tramo of perfil.tramos) {
    const desde = Math.min(tramo.desde_m, perfil.profundidad_m);
    const hasta = Math.min(tramo.hasta_m, perfil.profundidad_m);
    if (hasta <= desde) continue;
    const yHasta = yDeProfundidad(hasta);
    const [r, g, b] = tramo.color;
    page.drawRectangle({
      x: xColumna,
      y: yHasta,
      width: anchoColumna,
      height: yDeProfundidad(desde) - yHasta,
      color: rgb(r, g, b),
      borderWidth: 0.35,
      borderColor: rgb(0.25, 0.25, 0.25),
    });
  }

  for (let metros = 0; metros <= perfil.profundidad_m; metros += perfil.paso_escala_m) {
    const y = yDeProfundidad(metros);
    page.drawLine({
      start: { x: xColumna - 6, y },
      end: { x: xColumna, y },
      thickness: 0.6,
      color: rgb(0.2, 0.2, 0.2),
    });
    page.drawText(`${metros} m`, { x: 55, y: y - 3, size: 8, font });
  }
  if (perfil.profundidad_m % perfil.paso_escala_m !== 0) {
    page.drawText(`${perfil.profundidad_m} m`, {
      x: 55,
      y: ySuperior - alto - 3,
      size: 8,
      font,
    });
  }

  page.drawText("Intervalos", { x: 260, y: ySuperior, size: 12, font: bold });
  let yLeyenda = ySuperior - 22;
  for (const tramo of perfil.tramos) {
    if (yLeyenda < 85) break;
    const [r, g, b] = tramo.color;
    page.drawRectangle({ x: 260, y: yLeyenda - 2, width: 10, height: 10, color: rgb(r, g, b) });
    const material = textoSeguro(tramo.material.trim());
    const etiqueta = `${tramo.desde_m}-${tramo.hasta_m} m  ${material}`;
    page.drawText(etiqueta.slice(0, 48), { x: 278, y: yLeyenda, size: 9, font });
    yLeyenda -= 18;
  }
  if (perfil.tramos.length === 0) {
    page.drawText("Sin intervalos litologicos registrados.", {
      x: 260,
      y: yLeyenda,
      size: 9,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
  } else if (yLeyenda < 85) {
    page.drawText("La tabla del informe contiene el detalle completo.", {
      x: 260,
      y: 65,
      size: 8,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
  }

  return page;
}
