import { myPool } from '../db/pool.ts';
import { formatearFechaCalendario } from '../utils/fechas.ts';

export const KML_FILENAME = 'perforaciones-raulsilva.kml';
export const KML_CONTENT_TYPE = 'application/vnd.google-earth.kml+xml';

export interface PerforacionKml {
  numero_perforacion: unknown;
  propietario: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  profundidad_final_m: string | number | null;
  caudal_estimado_lh: number | null;
  departamento: string | null;
  localidad: string | null;
  latitud: unknown;
  longitud: unknown;
}

function escaparXml(valor: string): string {
  // XML 1.0 no admite controles ni surrogates aislados, ni siquiera como entidades.
  return valor.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '\uFFFD')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function coordenada(valor: unknown, limite: number): number | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const texto = String(valor).trim();
  // Solo grados decimales: no convertir vacíos, hexadecimal, texto parcial o DMS.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(texto)) return null;
  const numero = Number(texto);
  return Number.isFinite(numero) && Math.abs(numero) <= limite ? numero : null;
}

function texto(valor: string | number | null | undefined, unidad = ''): string {
  if (valor == null || String(valor).trim() === '') return 'No registrado';
  return `${valor}${unidad}`;
}

export function generarKml(filas: readonly PerforacionKml[]) {
  const carpetas = new Map<string, string[]>();
  let exportadas = 0;
  let omitidasPorCoordenadas = 0;
  let omitidasPorNumero = 0;
  for (const fila of filas) {
    const latitud = coordenada(fila.latitud, 90);
    const longitud = coordenada(fila.longitud, 180);
    // Razones excluyentes: si faltan ambos datos, se cuenta primero por coordenadas.
    if (latitud === null || longitud === null) { omitidasPorCoordenadas++; continue; }
    const numero = fila.numero_perforacion;
    // Mismo rango del INTEGER y del contrato comercial existente; sin asignar números.
    if (typeof numero !== 'number' || !Number.isInteger(numero) || numero < 1 || numero > 2147483647) {
      omitidasPorNumero++;
      continue;
    }
    const departamento = fila.departamento?.trim() || 'Sin departamento';
    const campos = [
      ['Número', String(numero)],
      ['Propietario', texto(fila.propietario)],
      ['Fecha de inicio', formatearFechaCalendario(fila.fecha_inicio)],
      ['Fecha de finalización', formatearFechaCalendario(fila.fecha_fin)],
      ['Departamento', texto(fila.departamento)],
      ['Localidad', texto(fila.localidad)],
      ['Profundidad final', texto(fila.profundidad_final_m, ' m')],
      ['Caudal estimado', texto(fila.caudal_estimado_lh, ' l/h')],
      ['Latitud', String(latitud)],
      ['Longitud', String(longitud)],
    ];
    // Google Earth interpreta la descripción como HTML: escapar primero los datos
    // para HTML y después el contenido completo para el elemento XML.
    const descripcion = '<table>' + campos.map(([nombre, valor]) =>
      `<tr><th>${nombre}</th><td>${escaparXml(valor)}</td></tr>`).join('') + '</table>';
    const punto = `<Placemark><name>P-${numero}</name>`
      + `<description>${escaparXml(descripcion)}</description>`
      + `<Point><coordinates>${longitud},${latitud},0</coordinates></Point></Placemark>`;
    if (!carpetas.has(departamento)) carpetas.set(departamento, []);
    carpetas.get(departamento)!.push(punto);
    exportadas++;
  }
  const contenido = [...carpetas].map(([nombre, puntos]) =>
    `<Folder><name>${escaparXml(nombre)}</name>\n${puntos.join('\n')}\n</Folder>`).join('\n');
  const kml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
    + '<name>Perforaciones Raúl Silva</name>\n' + contenido + '\n</Document></kml>\n';
  return { kml, exportadas, omitidas: omitidasPorCoordenadas + omitidasPorNumero, omitidasPorCoordenadas, omitidasPorNumero };
}

export async function exportarKml() {
  // Una lectura consistente incluye también históricos y pozos sin sitio, para
  // contarlos como omitidos. Solo lee el número asignado, sin alterar la numeración.
  const { rows } = await myPool.query<PerforacionKml>(`
    SELECT p.numero_perforacion,
      COALESCE(NULLIF(trim(u.nombre), ''), NULLIF(trim(p.propietario_provisional), '')) AS propietario,
      to_char(p.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
      to_char(p.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
      p.profundidad_final_m, p.caudal_estimado_lh,
      s.departamento, s.localidad, s.latitud, s.longitud
    FROM public.pozo p
    LEFT JOIN public.usuario u ON u.id_usuario = p.id_propietario
    LEFT JOIN public.sitio s ON s.id_sitio = p.id_sitio
    ORDER BY s.departamento NULLS LAST, p.numero_perforacion NULLS LAST, p.id_pozo
  `);
  return generarKml(rows);
}
