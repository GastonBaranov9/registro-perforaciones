import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";

export interface IntervaloPerfilLitologico {
  desde_m: number;
  hasta_m: number;
  material: string;
  descripcion?: string | null;
}

export interface AportePerfilLitologico {
  profundidad_m: number;
}
export type MaterialTuberia = "PVC" | "Acero";
export interface IntervaloConstructivo { desde_m:number; hasta_m:number; diametro_pulg:number; material_tuberia:MaterialTuberia|null; }
export interface TramoConstructivo extends IntervaloConstructivo { tipo:"tuberia"|"filtro"; material_texto:string; geometria:{x_inicio:number;x_fin:number;patron:"liso"|"metal"|"ranuras"}; }

export interface AporteRepresentado extends AportePerfilLitologico {
  tipo: "puntual";
  desde_m: number;
  hasta_m: number;
  geometria: { x_inicio: 0.05; x_fin: 0.95; espesor_min_px: 8; patron: "ondas" };
}

export type PatronLitologico = "diagonal" | "diagonal-inversa" | "cruz" | "puntos" | "horizontal" | "vertical";

export interface EstiloLitologico {
  color: string;
  gris: number;
  patron: PatronLitologico;
}

export interface TramoPerfilLitologico {
  clase: "litologia" | "hueco";
  desde_m: number;
  hasta_m: number;
  material: string;
  descripcion: string | null;
  estilo: EstiloLitologico;
  carril_etiqueta: number;
}

export interface RangoPerfilLitologico {
  desde_m: number;
  hasta_m: number;
}

export interface PerfilLitologico {
  titulo: "Perfil litológico del pozo";
  profundidad_m: number;
  paso_escala_m: number;
  tramos: TramoPerfilLitologico[];
  aportes: AporteRepresentado[];
  tuberias: TramoConstructivo[];
  filtros: TramoConstructivo[];
  seccion_pozo: { tuberia_exterior_inicio: 0.36; tuberia_exterior_fin: 0.64; tuberia_interior_inicio: 0.43; tuberia_interior_fin: 0.57 };
  rangos: RangoPerfilLitologico[];
  advertencias: string[];
  tiene_litologia: boolean;
}

export class PerfilLitologicoInvalido extends Error {
  readonly errores: string[];
  readonly statusCode = 422;

  constructor(errores: string[]) {
    super(errores.join(" "));
    this.name = "PerfilLitologicoInvalido";
    this.errores = errores;
  }
}

const ESTILOS: readonly EstiloLitologico[] = [
  { color: "#D8AB52", gris: 0.72, patron: "puntos" },
  { color: "#AD7347", gris: 0.52, patron: "horizontal" },
  { color: "#8F9FAE", gris: 0.62, patron: "diagonal" },
  { color: "#D1C291", gris: 0.78, patron: "cruz" },
  { color: "#7A9473", gris: 0.55, patron: "diagonal-inversa" },
  { color: "#B88578", gris: 0.59, patron: "vertical" },
];

const ESTILO_HUECO: EstiloLitologico = { color: "#F5F5F5", gris: 0.95, patron: "cruz" };

export function normalizarMaterial(material: string) {
  return material.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

export function estiloDeMaterial(material: string): EstiloLitologico {
  const clave = normalizarMaterial(material);
  let hash = 0;
  for (const caracter of clave) hash = (hash * 31 + caracter.charCodeAt(0)) >>> 0;
  return { ...ESTILOS[hash % ESTILOS.length] };
}

export function colorDeMaterial(material: string): readonly [number, number, number] {
  return hexARgb(estiloDeMaterial(material).color);
}

export function calcularPasoEscala(profundidad_m: number) {
  if (profundidad_m <= 20) return 2;
  if (profundidad_m <= 50) return 5;
  if (profundidad_m <= 100) return 10;
  if (profundidad_m <= 250) return 25;
  if (profundidad_m <= 500) return 50;
  return 100;
}

function calcularRangos(profundidad_m: number, intervalos: readonly IntervaloPerfilLitologico[]): RangoPerfilLitologico[] {
  const rangos: RangoPerfilLitologico[] = [];
  let desde_m = 0;
  while (desde_m < profundidad_m) {
    const limiteProfundidad = Math.min(desde_m + 100, profundidad_m);
    const capas = intervalos.filter((tramo) => tramo.hasta_m > desde_m && tramo.desde_m < limiteProfundidad);
    const hasta_m = capas.length > 18 ? Math.min(limiteProfundidad, capas[17].hasta_m) : limiteProfundidad;
    rangos.push({ desde_m, hasta_m });
    desde_m = hasta_m;
  }
  return rangos;
}

function asignarCarriles(tramos: Array<Omit<TramoPerfilLitologico, "carril_etiqueta">>, profundidad_m: number) {
  const ultimaEtiqueta = [-Infinity, -Infinity, -Infinity];
  const separacion = profundidad_m / Math.max(12, Math.min(30, tramos.length));
  return tramos.map((tramo) => {
    const centro = (tramo.desde_m + tramo.hasta_m) / 2;
    let carril = ultimaEtiqueta.findIndex((ultima) => centro - ultima >= separacion);
    if (carril < 0) carril = ultimaEtiqueta.indexOf(Math.min(...ultimaEtiqueta));
    ultimaEtiqueta[carril] = centro;
    return { ...tramo, carril_etiqueta: carril };
  });
}

export function crearPerfilLitologico(
  intervalos: readonly IntervaloPerfilLitologico[],
  profundidadFinal_m?: number | null,
  aportes: readonly AportePerfilLitologico[] = [],
  tuberias: readonly IntervaloConstructivo[] = [],
  filtros: readonly IntervaloConstructivo[] = [],
): PerfilLitologico | null {
  const errores: string[] = [];
  const ordenados = [...intervalos].sort((a, b) => a.desde_m - b.desde_m || a.hasta_m - b.hasta_m);
  const profundidadDeclarada = profundidadFinal_m != null && Number.isFinite(profundidadFinal_m) && profundidadFinal_m > 0 ? profundidadFinal_m : 0;
  if (ordenados.length > 0 && profundidadDeclarada === 0) errores.push("La profundidad oficial del pozo es obligatoria para representar la litología.");
  for (const [indice, tramo] of ordenados.entries()) {
    if (!Number.isFinite(tramo.desde_m) || tramo.desde_m < 0) errores.push(`Intervalo ${indice + 1}: desdeM debe ser mayor o igual a 0.`);
    if (!Number.isFinite(tramo.hasta_m) || tramo.hasta_m <= tramo.desde_m) errores.push(`Intervalo ${indice + 1}: hastaM debe ser mayor que desdeM.`);
    if (!tramo.material.trim()) errores.push(`Intervalo ${indice + 1}: material es obligatorio.`);
    if (profundidadDeclarada > 0 && tramo.hasta_m > profundidadDeclarada) errores.push(`Intervalo ${indice + 1}: excede la profundidad oficial del pozo.`);
    if (indice > 0 && tramo.desde_m < ordenados[indice - 1].hasta_m) errores.push(`Los intervalos ${indice} y ${indice + 1} se solapan.`);
  }
  if (errores.length) throw new PerfilLitologicoInvalido(errores);

  const profundidad_m = profundidadDeclarada;
  if (profundidad_m <= 0) return null;

  const advertencias: string[] = [];
  const base: Array<Omit<TramoPerfilLitologico, "carril_etiqueta">> = [];
  let cursor = 0;
  for (const tramo of ordenados) {
    if (tramo.desde_m > cursor) {
      base.push({ clase: "hueco", desde_m: cursor, hasta_m: tramo.desde_m, material: "Sin información litológica", descripcion: null, estilo: { ...ESTILO_HUECO } });
    }
    base.push({ clase: "litologia", desde_m: tramo.desde_m, hasta_m: tramo.hasta_m, material: tramo.material.trim(), descripcion: tramo.descripcion?.trim() || null, estilo: estiloDeMaterial(tramo.material) });
    cursor = tramo.hasta_m;
  }
  if (cursor < profundidad_m) base.push({ clase: "hueco", desde_m: cursor, hasta_m: profundidad_m, material: "Sin información litológica", descripcion: null, estilo: { ...ESTILO_HUECO } });

  const aportesValidos = aportes
    .filter((aporte) => Number.isFinite(aporte.profundidad_m) && aporte.profundidad_m >= 0 && aporte.profundidad_m <= profundidad_m)
    .map((aporte): AporteRepresentado => ({
      profundidad_m: aporte.profundidad_m, tipo: "puntual", desde_m: aporte.profundidad_m, hasta_m: aporte.profundidad_m,
      geometria: { x_inicio: 0.05, x_fin: 0.95, espesor_min_px: 8, patron: "ondas" },
    }))
    .sort((a, b) => a.profundidad_m - b.profundidad_m);
  if (aportesValidos.length !== aportes.length) advertencias.push("Se omitieron aportes fuera de la profundidad representada.");

  const maxDiametro = Math.max(1, ...tuberias.map((i) => i.diametro_pulg), ...filtros.map((i) => i.diametro_pulg));
  const construir = (items: readonly IntervaloConstructivo[], tipo: "tuberia"|"filtro") => items.map((item): TramoConstructivo => {
    const mitad = 0.08 + 0.12 * item.diametro_pulg / maxDiametro;
    return { ...item, tipo, material_texto:item.material_tuberia ?? "No especificado", geometria:{x_inicio:0.5-mitad,x_fin:0.5+mitad,patron:tipo === "filtro" ? "ranuras" : item.material_tuberia === "Acero" ? "metal" : "liso"} };
  });

  return {
    titulo: "Perfil litológico del pozo",
    profundidad_m,
    paso_escala_m: calcularPasoEscala(profundidad_m),
    tramos: asignarCarriles(base, profundidad_m),
    aportes: aportesValidos,
    tuberias: construir(tuberias, "tuberia"),
    filtros: construir(filtros, "filtro"),
    seccion_pozo: { tuberia_exterior_inicio: 0.36, tuberia_exterior_fin: 0.64, tuberia_interior_inicio: 0.43, tuberia_interior_fin: 0.57 },
    rangos: calcularRangos(profundidad_m, ordenados),
    advertencias,
    tiene_litologia: ordenados.length > 0,
  };
}

function hexARgb(hex: string): readonly [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16) / 255, Number.parseInt(hex.slice(3, 5), 16) / 255, Number.parseInt(hex.slice(5, 7), 16) / 255];
}

function textoSeguro(texto: string) {
  return texto.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function dibujarPatron(page: PDFPage, patron: PatronLitologico, x: number, y: number, ancho: number, alto: number) {
  const color = rgb(0.25, 0.25, 0.25);
  const paso = 7;
  if (patron === "puntos") {
    for (let py = y + 3; py < y + alto; py += paso) for (let px = x + 3; px < x + ancho; px += paso) page.drawCircle({ x: px, y: py, size: 0.7, color });
    return;
  }
  if (patron === "horizontal" || patron === "cruz") for (let py = y + paso; py < y + alto; py += paso) page.drawLine({ start: { x, y: py }, end: { x: x + ancho, y: py }, thickness: 0.35, color });
  if (patron === "vertical" || patron === "cruz") for (let px = x + paso; px < x + ancho; px += paso) page.drawLine({ start: { x: px, y }, end: { x: px, y: y + alto }, thickness: 0.35, color });
  if (patron === "diagonal" || patron === "diagonal-inversa") {
    for (let offset = -alto; offset < ancho; offset += paso) {
      const pendiente = patron === "diagonal" ? 1 : -1;
      const x1 = Math.max(x, x + offset);
      const x2 = Math.min(x + ancho, x + offset + alto);
      if (x2 > x1) page.drawLine({ start: { x: x1, y: y + (x1 - x - offset) * pendiente + (pendiente < 0 ? alto : 0) }, end: { x: x2, y: y + (x2 - x - offset) * pendiente + (pendiente < 0 ? alto : 0) }, thickness: 0.35, color });
    }
  }
}

export function dibujarPerfilLitologico(doc: PDFDocument, perfil: PerfilLitologico, font: PDFFont, bold: PDFFont): PDFPage[] {
  return perfil.rangos.map((rango, indice) => {
    const page = doc.addPage([595.28, 841.89]);
    const alto = 650;
    const ySuperior = 735;
    const xColumna = 90;
    const anchoColumna = 120;
    const amplitud = rango.hasta_m - rango.desde_m;
    const yDe = (metros: number) => ySuperior - ((metros - rango.desde_m) / amplitud) * alto;
    page.drawText(textoSeguro(perfil.titulo), { x: 45, y: 790, size: 17, font: bold, color: rgb(0, 0.2, 0.5) });
    page.drawText(`Rango ${formatearMetros(rango.desde_m)}-${formatearMetros(rango.hasta_m)} m | pagina ${indice + 1}/${perfil.rangos.length}`, { x: 45, y: 768, size: 9, font });
    page.drawRectangle({ x: xColumna, y: ySuperior - alto, width: anchoColumna, height: alto, borderWidth: 1.2, borderColor: rgb(0.1, 0.1, 0.1), color: rgb(0.97, 0.97, 0.97) });

    for (const tramo of perfil.tramos) {
      const desde = Math.max(tramo.desde_m, rango.desde_m);
      const hasta = Math.min(tramo.hasta_m, rango.hasta_m);
      if (hasta <= desde) continue;
      const y = yDe(hasta);
      const h = yDe(desde) - y;
      const [r, g, b] = hexARgb(tramo.estilo.color);
      page.drawRectangle({ x: xColumna, y, width: anchoColumna, height: h, color: rgb(r, g, b), borderWidth: 0.6, borderColor: rgb(0.15, 0.15, 0.15) });
      dibujarPatron(page, tramo.estilo.patron, xColumna, y, anchoColumna, h);
      const centro = Math.max(90, Math.min(730, yDe((desde + hasta) / 2)));
      const xTexto = 245 + tramo.carril_etiqueta * 92;
      page.drawLine({ start: { x: xColumna + anchoColumna, y: centro }, end: { x: xTexto - 5, y: centro }, thickness: 0.35, color: rgb(0.4, 0.4, 0.4) });
      const etiqueta = `${formatearMetros(tramo.desde_m)}-${formatearMetros(tramo.hasta_m)} m ${textoSeguro(tramo.material)}`;
      const lineas = envolverTexto(etiqueta, font, 7.2, 84);
      lineas.forEach((linea, numero) => page.drawText(linea, { x: xTexto, y: centro + ((lineas.length - 1) / 2 - numero) * 8 - 3, size: 7.2, font }));
    }

    const primerTick = Math.ceil(rango.desde_m / perfil.paso_escala_m) * perfil.paso_escala_m;
    const ticks = new Set([rango.desde_m, rango.hasta_m]);
    for (let m = primerTick; m < rango.hasta_m; m += perfil.paso_escala_m) ticks.add(m);
    for (const metros of [...ticks].sort((a, b) => a - b)) {
      const y = yDe(metros);
      page.drawLine({ start: { x: xColumna - 6, y }, end: { x: 545, y }, thickness: 0.25, color: rgb(0.68, 0.68, 0.68), dashArray: [2, 3] });
      page.drawText(`${formatearMetros(metros)} m`, { x: 45, y: y - 3, size: 8, font });
    }
    for (const aporte of perfil.aportes.filter((a) => a.profundidad_m >= rango.desde_m && a.profundidad_m <= rango.hasta_m)) {
      const y = yDe(aporte.profundidad_m);
      const x1 = xColumna + anchoColumna * aporte.geometria.x_inicio;
      const x2 = xColumna + anchoColumna * aporte.geometria.x_fin;
      const hBanda = 6;
      page.drawRectangle({ x: x1, y: y - hBanda / 2, width: x2 - x1, height: hBanda, color: rgb(0.65, 0.84, 0.96), opacity: 0.78, borderColor: rgb(0.02, 0.25, 0.55), borderWidth: 0.6 });
      for (let x = x1 + 2; x < x2 - 5; x += 9) {
        page.drawLine({ start: { x, y: y - 1.5 }, end: { x: x + 3, y: y + 1.5 }, thickness: 0.65, color: rgb(0.02, 0.3, 0.65) });
        page.drawLine({ start: { x: x + 3, y: y + 1.5 }, end: { x: x + 6, y: y - 1.5 }, thickness: 0.65, color: rgb(0.02, 0.3, 0.65) });
      }
      page.drawCircle({ x: xColumna + anchoColumna + 8, y, size: 3.4, color: rgb(0.05, 0.35, 0.85), borderColor: rgb(0, 0.15, 0.45), borderWidth: 0.7 });
      page.drawText(`Aporte de agua ${formatearMetros(aporte.profundidad_m)} m`, { x: xColumna + anchoColumna + 15, y: y - 3, size: 7.5, font, color: rgb(0.03, 0.25, 0.65) });
    }
    for (const tramo of [...perfil.tuberias, ...perfil.filtros].filter((t) => t.desde_m < rango.hasta_m && t.hasta_m > rango.desde_m)) {
      const desde=Math.max(tramo.desde_m,rango.desde_m), hasta=Math.min(tramo.hasta_m,rango.hasta_m);
      const x=xColumna+anchoColumna*tramo.geometria.x_inicio, w=anchoColumna*(tramo.geometria.x_fin-tramo.geometria.x_inicio);
      const yy=yDe(hasta), hh=yDe(desde)-yy;
      const acero=tramo.material_tuberia === "Acero";
      page.drawRectangle({x,y:yy,width:w,height:hh,borderWidth:1.2,borderColor:rgb(0.12,0.12,0.12),color:acero?rgb(0.48,0.51,0.54):rgb(0.93,0.95,0.96),opacity:0.72});
      if (tramo.tipo === "tuberia" && acero) for(let py=yy+4;py<yy+hh;py+=7) page.drawLine({start:{x,y:py},end:{x:x+w,y:py},thickness:.35,color:rgb(.2,.2,.2)});
      if (tramo.tipo === "filtro") for(let py=yy+4;py<yy+hh;py+=8) { page.drawLine({start:{x:x+2,y:py},end:{x:x+w-2,y:py},thickness:1,color:rgb(.1,.1,.1)}); }
      if (tramo.tipo === "filtro") page.drawText(`Filtro ${formatearMetros(tramo.desde_m)}-${formatearMetros(tramo.hasta_m)} m`,{x:xColumna+anchoColumna+15,y:Math.max(70,Math.min(740,yy+hh/2)),size:7,font});
    }
    const extX = xColumna + anchoColumna * perfil.seccion_pozo.tuberia_exterior_inicio;
    const extW = anchoColumna * (perfil.seccion_pozo.tuberia_exterior_fin - perfil.seccion_pozo.tuberia_exterior_inicio);
    const intX = xColumna + anchoColumna * perfil.seccion_pozo.tuberia_interior_inicio;
    const intW = anchoColumna * (perfil.seccion_pozo.tuberia_interior_fin - perfil.seccion_pozo.tuberia_interior_inicio);
    page.drawRectangle({ x: extX, y: ySuperior - alto, width: extW, height: alto, borderWidth: 1, borderColor: rgb(0.18, 0.18, 0.18), opacity: 0 });
    page.drawRectangle({ x: intX, y: ySuperior - alto, width: intW, height: alto, borderWidth: 0.7, borderColor: rgb(0.35, 0.35, 0.35), opacity: 0 });
    page.drawText("Leyenda: PVC claro | Acero tramado | Filtro ranurado | banda ondulada = Aporte de agua", { x: 45, y: 55, size: 8, font });
    return page;
  });
}

function formatearMetros(valor: number) {
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function envolverTexto(texto: string, font: PDFFont, tamano: number, ancho: number) {
  const lineas: string[] = [];
  let actual = "";
  for (const palabraOriginal of texto.split(/\s+/)) {
    let palabra = palabraOriginal;
    while (font.widthOfTextAtSize(palabra, tamano) > ancho) {
      let corte = 1;
      while (corte < palabra.length && font.widthOfTextAtSize(palabra.slice(0, corte + 1), tamano) <= ancho) corte++;
      if (actual) lineas.push(actual);
      lineas.push(palabra.slice(0, corte));
      palabra = palabra.slice(corte);
      actual = "";
    }
    const candidato = actual ? `${actual} ${palabra}` : palabra;
    if (font.widthOfTextAtSize(candidato, tamano) <= ancho) actual = candidato;
    else {
      if (actual) lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}
