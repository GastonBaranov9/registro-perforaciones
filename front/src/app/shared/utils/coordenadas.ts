export type EjeCoordenada = 'latitud' | 'longitud';

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const DMS = /^([+-]?)(\d{1,3})\s*(?:°|\s)\s*(\d{1,2})\s*(?:['’′]|\s)\s*(\d{1,2}(?:\.\d+)?)\s*(?:["”″])?\s*([NSEW])$/i;

// Contrato equivalente al normalizador autoritativo del backend. El frontend lo aplica
// al perder foco para dar respuesta inmediata; el backend vuelve a validar antes de persistir.
export function normalizarCoordenadaTexto(valor: unknown, eje: EjeCoordenada): string | null {
  const texto = valor == null ? '' : String(valor).trim();
  if (!texto) return null;
  if (DECIMAL.test(texto)) {
    const numero = Number(texto);
    const limite = eje === 'latitud' ? 90 : 180;
    if (!Number.isFinite(numero) || numero < -limite || numero > limite) return null;
    return Object.is(numero, -0) || numero === 0 ? '0' : texto;
  }
  const partes = DMS.exec(texto);
  if (!partes) return null;
  const [, signoExplicito, gradosTexto, minutosTexto, segundosTexto, orientacionCruda] = partes;
  if (signoExplicito) return null;
  const orientacion = orientacionCruda.toUpperCase();
  if (eje === 'latitud' ? !['N', 'S'].includes(orientacion) : !['E', 'W'].includes(orientacion)) return null;
  const grados = Number(gradosTexto), minutos = Number(minutosTexto), segundos = Number(segundosTexto);
  const limite = eje === 'latitud' ? 90 : 180;
  if (grados > limite || minutos >= 60 || segundos >= 60) return null;
  let decimal = grados + minutos / 60 + segundos / 3600;
  if (decimal > limite) return null;
  if (orientacion === 'S' || orientacion === 'W') decimal *= -1;
  if (decimal === 0) return '0';
  return decimal.toFixed(7).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

export function coordenadasRegistradasValidas(latitud: unknown, longitud: unknown): boolean {
  return normalizarCoordenadaTexto(latitud, 'latitud') !== null && normalizarCoordenadaTexto(longitud, 'longitud') !== null;
}
