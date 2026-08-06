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
export interface TramoConstructivo extends IntervaloConstructivo { tipo:"tuberia"|"filtro"; material_texto:string; carril_etiqueta:number; geometria:{x_inicio:number;x_fin:number;patron:"liso"|"metal"|"ranuras"}; }

export type TipoEtiquetaPerfil = "litologia" | "tuberia" | "filtro" | "aporte";
export interface EtiquetaPerfil {
  clave: string;
  tipo: TipoEtiquetaPerfil;
  texto: string;
  profundidad_anclaje_m: number;
  rango_desde_m: number;
  posicion_y_normalizada: number;
  carril: 0 | 1 | 2 | 3;
  x_anclaje_normalizado: number;
  x_texto_normalizado: number;
  conector: { puntos: Array<{ x_normalizada: number; y_normalizada: number }> };
  caja_texto: { x_normalizada:number; y_normalizada:number; ancho_normalizado:number; alto_normalizado:number };
}

export interface AporteRepresentado extends AportePerfilLitologico {
  tipo: "puntual";
  desde_m: number;
  hasta_m: number;
  geometria: { x_inicio: 0.03; x_fin: 0.97; espesor_min_px: 12; patron: "ondas" };
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
  etiquetas: EtiquetaPerfil[];
  seccion_pozo: { tuberia_exterior_inicio: 0.36; tuberia_exterior_fin: 0.64; tuberia_interior_inicio: 0.43; tuberia_interior_fin: 0.57 };
  geometria: GeometriaCanonicaPerfil;
  rangos: RangoPerfilLitologico[];
  advertencias: string[];
  tiene_litologia: boolean;
}

export interface GeometriaCanonicaPerfil {
  ancho_logico: 760;
  alto_logico: 820;
  columna: { x: 90; y: 70; ancho: 180; alto: 700 };
  x_texto_escala: 12;
  carriles_etiqueta_x: readonly [310, 390, 470, 550];
  separacion_vertical_normalizada: number;
  conector: { salida:12; llegada:8 };
  alto_texto:16;
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
export const GEOMETRIA_CANONICA_PERFIL: GeometriaCanonicaPerfil = {
  ancho_logico: 760,
  alto_logico: 820,
  columna: { x: 90, y: 70, ancho: 180, alto: 700 },
  x_texto_escala:12,
  carriles_etiqueta_x: [310, 390, 470, 550],
  separacion_vertical_normalizada: 0.055,
  conector:{salida:12,llegada:8},
  alto_texto:16,
};

export function transformarPuntoCanonicoPdf(punto: { x_normalizada:number; y_normalizada:number }) {
  return { x:45+punto.x_normalizada*505, y:795-punto.y_normalizada*750 };
}

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
    const hasta_m = capas.length > 12 ? Math.min(limiteProfundidad, capas[11].hasta_m) : limiteProfundidad;
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

export function resolverColisionesEtiquetas<T extends { preferida: number }>(entradas: readonly T[]): Array<T & { posicion: number }> {
  if (!entradas.length) return [];
  const ordenadas = [...entradas].sort((a, b) => a.preferida - b.preferida);
  const margen = 0.025;
  const separacion = Math.min(GEOMETRIA_CANONICA_PERFIL.separacion_vertical_normalizada, (1 - margen * 2) / Math.max(1, ordenadas.length - 1));
  const posiciones: number[] = [];
  for (const entrada of ordenadas) posiciones.push(Math.max(margen, entrada.preferida, (posiciones.at(-1) ?? -Infinity) + separacion));
  const exceso = Math.max(0, (posiciones.at(-1) ?? 1) - (1 - margen));
  if (exceso) for (let i = 0; i < posiciones.length; i++) posiciones[i] -= exceso;
  for (let i = posiciones.length - 2; i >= 0; i--) posiciones[i] = Math.min(posiciones[i], posiciones[i + 1] - separacion);
  return ordenadas.map((entrada, indice) => ({ ...entrada, posicion: Math.max(margen, posiciones[indice]) }));
}

function textoTuberia(tramo: TramoConstructivo) {
  const material = tramo.material_tuberia ?? "material no especificado";
  const tipo = tramo.tipo === "filtro" ? "Filtro ranurado" : "Tubería";
  return `${tipo} ${material} · Ø ${formatearMetros(tramo.diametro_pulg)} pulg · ${formatearMetros(tramo.desde_m)}-${formatearMetros(tramo.hasta_m)} m`;
}

function crearEtiquetas(
  rangos: readonly RangoPerfilLitologico[],
  tramos: readonly TramoPerfilLitologico[],
  tuberias: readonly TramoConstructivo[],
  filtros: readonly TramoConstructivo[],
  aportes: readonly AporteRepresentado[],
): EtiquetaPerfil[] {
  const resultado: EtiquetaPerfil[] = [];
  for (const rango of rangos) {
    const amplitud = rango.hasta_m - rango.desde_m;
    const candidatas: Array<Omit<EtiquetaPerfil, "posicion_y_normalizada" | "x_texto_normalizado" | "conector" | "caja_texto"> & { preferida: number }> = [];
    for (const tramo of tramos.filter((item) => item.desde_m < rango.hasta_m && item.hasta_m > rango.desde_m)) {
      const anclaje = (Math.max(tramo.desde_m, rango.desde_m) + Math.min(tramo.hasta_m, rango.hasta_m)) / 2;
      candidatas.push({ clave:`lit-${tramo.desde_m}-${tramo.hasta_m}`,tipo:"litologia",texto:`${formatearMetros(tramo.desde_m)}-${formatearMetros(tramo.hasta_m)} m · ${tramo.material}`,profundidad_anclaje_m:anclaje,rango_desde_m:rango.desde_m,carril:0,x_anclaje_normalizado:1,preferida:(anclaje-rango.desde_m)/amplitud });
    }
    for (const tramo of tuberias.filter((item) => item.desde_m < rango.hasta_m && item.hasta_m > rango.desde_m)) {
      const anclaje = (Math.max(tramo.desde_m, rango.desde_m) + Math.min(tramo.hasta_m, rango.hasta_m)) / 2;
      candidatas.push({ clave:`tub-${tramo.desde_m}-${tramo.hasta_m}`,tipo:"tuberia",texto:textoTuberia(tramo),profundidad_anclaje_m:anclaje,rango_desde_m:rango.desde_m,carril:1,x_anclaje_normalizado:tramo.geometria.x_fin,preferida:(anclaje-rango.desde_m)/amplitud });
    }
    for (const tramo of filtros.filter((item) => item.desde_m < rango.hasta_m && item.hasta_m > rango.desde_m)) {
      const anclaje = (Math.max(tramo.desde_m, rango.desde_m) + Math.min(tramo.hasta_m, rango.hasta_m)) / 2;
      candidatas.push({ clave:`fil-${tramo.desde_m}-${tramo.hasta_m}`,tipo:"filtro",texto:textoTuberia(tramo),profundidad_anclaje_m:anclaje,rango_desde_m:rango.desde_m,carril:2,x_anclaje_normalizado:tramo.geometria.x_fin,preferida:(anclaje-rango.desde_m)/amplitud });
    }
    for (const aporte of aportes.filter((item) => item.profundidad_m >= rango.desde_m && item.profundidad_m <= rango.hasta_m)) {
      candidatas.push({ clave:`apo-${aporte.profundidad_m}`,tipo:"aporte",texto:`Aporte de agua ${formatearMetros(aporte.profundidad_m)} m`,profundidad_anclaje_m:aporte.profundidad_m,rango_desde_m:rango.desde_m,carril:3,x_anclaje_normalizado:aporte.geometria.x_fin,preferida:(aporte.profundidad_m-rango.desde_m)/amplitud });
    }
    resultado.push(...resolverColisionesEtiquetas(candidatas).map(({ preferida: _preferida, posicion, ...etiqueta }) => {
      const geometria = GEOMETRIA_CANONICA_PERFIL;
      const xAnclaje = (geometria.columna.x + geometria.columna.ancho * etiqueta.x_anclaje_normalizado) / geometria.ancho_logico;
      const yAnclaje = (geometria.columna.y + _preferida * geometria.columna.alto) / geometria.alto_logico;
      const xTexto = geometria.carriles_etiqueta_x[etiqueta.carril] / geometria.ancho_logico;
      const yTexto = (geometria.columna.y + posicion * geometria.columna.alto) / geometria.alto_logico;
      const salida = geometria.conector.salida / geometria.ancho_logico;
      const llegada = geometria.conector.llegada / geometria.ancho_logico;
      const altoTexto = geometria.alto_texto / geometria.alto_logico;
      return { ...etiqueta, posicion_y_normalizada: posicion, x_texto_normalizado: xTexto,
        conector: { puntos: [
          { x_normalizada: xAnclaje, y_normalizada: yAnclaje },
          { x_normalizada: xAnclaje + salida, y_normalizada: yAnclaje },
          { x_normalizada: xTexto - salida - llegada, y_normalizada: yTexto },
          { x_normalizada: xTexto - llegada, y_normalizada: yTexto },
        ] }, caja_texto: { x_normalizada:xTexto, y_normalizada:yTexto-altoTexto/2,
          ancho_normalizado:Math.min(etiqueta.texto.length*6.2/geometria.ancho_logico,1-xTexto), alto_normalizado:altoTexto },
      };
    }));
  }
  return resultado;
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
      geometria: { x_inicio: 0.03, x_fin: 0.97, espesor_min_px: 12, patron: "ondas" },
    }))
    .sort((a, b) => a.profundidad_m - b.profundidad_m);
  if (aportesValidos.length !== aportes.length) advertencias.push("Se omitieron aportes fuera de la profundidad representada.");

  const maxDiametro = Math.max(1, ...tuberias.map((i) => i.diametro_pulg), ...filtros.map((i) => i.diametro_pulg));
  const construir = (items: readonly IntervaloConstructivo[], tipo: "tuberia"|"filtro") => [...items]
    .sort((a, b) => a.desde_m - b.desde_m || a.hasta_m - b.hasta_m)
    .map((item, indice): TramoConstructivo => {
    const mitad = 0.08 + 0.12 * item.diametro_pulg / maxDiametro;
    return { ...item, tipo, material_texto:item.material_tuberia ?? "No especificado", carril_etiqueta: tipo === "filtro" ? indice % 3 : 0, geometria:{x_inicio:0.5-mitad,x_fin:0.5+mitad,patron:tipo === "filtro" ? "ranuras" : item.material_tuberia === "Acero" ? "metal" : "liso"} };
    });

  const tramos = asignarCarriles(base, profundidad_m);
  const tuberiasConstruidas = construir(tuberias, "tuberia");
  const filtrosConstruidos = construir(filtros, "filtro");
  const rangos = calcularRangos(profundidad_m, ordenados);
  return {
    titulo: "Perfil litológico del pozo",
    profundidad_m,
    paso_escala_m: calcularPasoEscala(profundidad_m),
    tramos,
    aportes: aportesValidos,
    tuberias: tuberiasConstruidas,
    filtros: filtrosConstruidos,
    etiquetas: crearEtiquetas(rangos, tramos, tuberiasConstruidas, filtrosConstruidos, aportesValidos),
    seccion_pozo: { tuberia_exterior_inicio: 0.36, tuberia_exterior_fin: 0.64, tuberia_interior_inicio: 0.43, tuberia_interior_fin: 0.57 },
    geometria: GEOMETRIA_CANONICA_PERFIL,
    rangos,
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
    const geometria = perfil.geometria;
    const xPdf = (xNormalizada: number) => transformarPuntoCanonicoPdf({x_normalizada:xNormalizada,y_normalizada:0}).x;
    const yPdf = (yNormalizada: number) => transformarPuntoCanonicoPdf({x_normalizada:0,y_normalizada:yNormalizada}).y;
    const xColumna = xPdf(geometria.columna.x / geometria.ancho_logico);
    const xFinColumna = xPdf((geometria.columna.x + geometria.columna.ancho) / geometria.ancho_logico);
    const anchoColumna = xFinColumna - xColumna;
    const ySuperior = yPdf(geometria.columna.y / geometria.alto_logico);
    const yInferior = yPdf((geometria.columna.y + geometria.columna.alto) / geometria.alto_logico);
    const alto = ySuperior - yInferior;
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
    }

    const primerTick = Math.ceil(rango.desde_m / perfil.paso_escala_m) * perfil.paso_escala_m;
    const ticks = new Set([rango.desde_m, rango.hasta_m]);
    for (let m = primerTick; m < rango.hasta_m; m += perfil.paso_escala_m) ticks.add(m);
    for (const metros of [...ticks].sort((a, b) => a - b)) {
      const y = yDe(metros);
      page.drawLine({ start: { x: xColumna - 6, y }, end: { x: xColumna, y }, thickness: 0.7, color: rgb(0.25, 0.25, 0.25) });
      page.drawText(`${formatearMetros(metros)} m`, { x: xPdf(geometria.x_texto_escala/geometria.ancho_logico), y: y - 3, size: 8, font });
    }
    for (const tramo of [...perfil.tuberias, ...perfil.filtros].filter((t) => t.desde_m < rango.hasta_m && t.hasta_m > rango.desde_m)) {
      const desde=Math.max(tramo.desde_m,rango.desde_m), hasta=Math.min(tramo.hasta_m,rango.hasta_m);
      const x=xColumna+anchoColumna*tramo.geometria.x_inicio, w=anchoColumna*(tramo.geometria.x_fin-tramo.geometria.x_inicio);
      const yy=yDe(hasta), hh=yDe(desde)-yy;
      const acero=tramo.material_tuberia === "Acero";
      const colorTuberia = acero ? rgb(0.48,0.51,0.54) : tramo.material_tuberia === "PVC" ? rgb(0.25,0.61,0.76) : rgb(0.72,0.72,0.72);
      page.drawRectangle({x,y:yy,width:w,height:hh,borderWidth:1.2,borderColor:rgb(0.12,0.12,0.12),color:colorTuberia,opacity:0.82});
      if (tramo.tipo === "tuberia" && acero) for(let py=yy+4;py<yy+hh;py+=7) page.drawLine({start:{x,y:py},end:{x:x+w,y:py},thickness:.35,color:rgb(.2,.2,.2)});
      if (tramo.tipo === "filtro") for(let py=yy+4;py<yy+hh;py+=7) {
        const ranura = Math.max(3, Math.min(7, w * 0.26));
        page.drawLine({start:{x:x+1.5,y:py},end:{x:x+1.5+ranura,y:py},thickness:1.5,color:rgb(.05,.05,.05)});
        page.drawLine({start:{x:x+w-1.5-ranura,y:py},end:{x:x+w-1.5,y:py},thickness:1.5,color:rgb(.05,.05,.05)});
      }
    }
    const extX = xColumna + anchoColumna * perfil.seccion_pozo.tuberia_exterior_inicio;
    const extW = anchoColumna * (perfil.seccion_pozo.tuberia_exterior_fin - perfil.seccion_pozo.tuberia_exterior_inicio);
    const intX = xColumna + anchoColumna * perfil.seccion_pozo.tuberia_interior_inicio;
    const intW = anchoColumna * (perfil.seccion_pozo.tuberia_interior_fin - perfil.seccion_pozo.tuberia_interior_inicio);
    page.drawRectangle({ x: extX, y: ySuperior - alto, width: extW, height: alto, borderWidth: 1, borderColor: rgb(0.18, 0.18, 0.18), opacity: 0 });
    page.drawRectangle({ x: intX, y: ySuperior - alto, width: intW, height: alto, borderWidth: 0.7, borderColor: rgb(0.35, 0.35, 0.35), opacity: 0 });
    for (const aporte of perfil.aportes.filter((a) => a.profundidad_m >= rango.desde_m && a.profundidad_m <= rango.hasta_m)) {
      const y = yDe(aporte.profundidad_m);
      const x1 = xColumna + anchoColumna * aporte.geometria.x_inicio;
      const x2 = xColumna + anchoColumna * aporte.geometria.x_fin;
      const hBanda = aporte.geometria.espesor_min_px / geometria.alto_logico * 750;
      page.drawRectangle({ x: x1, y: y - hBanda / 2, width: x2 - x1, height: hBanda, color: rgb(0.16, 0.66, 0.93), opacity: 0.88, borderColor: rgb(0.01, 0.2, 0.55), borderWidth: 1.2 });
      for (let x = x1 + 1; x < x2 - 6; x += 9) {
        page.drawLine({ start: { x, y: y - 2.4 }, end: { x: x + 3, y: y + 2.4 }, thickness: 1.05, color: rgb(0, 0.2, 0.58) });
        page.drawLine({ start: { x: x + 3, y: y + 2.4 }, end: { x: x + 6, y: y - 2.4 }, thickness: 1.05, color: rgb(0, 0.2, 0.58) });
      }
      page.drawCircle({ x: xColumna + anchoColumna + 8, y, size: 4.5, color: rgb(0.02, 0.42, 0.92), borderColor: rgb(0, 0.12, 0.4), borderWidth: 1 });
    }
    for (const etiqueta of perfil.etiquetas.filter((item) => item.rango_desde_m === rango.desde_m)) {
      const xTexto = xPdf(etiqueta.x_texto_normalizado);
      const yTexto = yPdf((geometria.columna.y + etiqueta.posicion_y_normalizada * geometria.columna.alto) / geometria.alto_logico);
      const puntos = etiqueta.conector.puntos.map((punto) => ({ x:xPdf(punto.x_normalizada), y:yPdf(punto.y_normalizada) }));
      for (let punto=1;punto<puntos.length;punto++) page.drawLine({ start:puntos[punto-1], end:puntos[punto], thickness:0.45, color:rgb(0.32,0.32,0.32) });
      page.drawText(textoSeguro(etiqueta.texto), { x:xTexto, y:yTexto-2.5, size:6.2, font:etiqueta.tipo === "aporte" ? bold : font, color:etiqueta.tipo === "aporte" ? rgb(0.01,0.2,0.58) : rgb(0.08,0.08,0.08) });
    }
    page.drawText("Leyenda: PVC celeste | Acero gris tramado | Filtro ranurado | banda azul ondulada = Aporte de agua", { x: 45, y: 55, size: 8, font });
    return page;
  });
}

function formatearMetros(valor: number) {
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
