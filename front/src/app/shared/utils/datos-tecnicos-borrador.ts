import { DatosTecnicosBorrador } from '../types/schemas';

export type SugerenciaIntervalo = { permitido: true; desde_m: number } | { permitido: false; mensaje: string };

export function sugerirInicioSiguienteIntervalo(
  intervalos: ReadonlyArray<{ desde_m: number; hasta_m: number }>,
  profundidad?: number,
): SugerenciaIntervalo {
  if (intervalos.length === 0) return { permitido: true, desde_m: 0 };
  const ordenados = [...intervalos].sort((a, b) => a.desde_m - b.desde_m || a.hasta_m - b.hasta_m);
  for (const [indice, intervalo] of ordenados.entries()) {
    if (!Number.isFinite(intervalo.desde_m) || intervalo.desde_m < 0 || !Number.isFinite(intervalo.hasta_m) || intervalo.hasta_m <= intervalo.desde_m)
      return { permitido: false, mensaje: 'Corrija los intervalos inválidos antes de agregar otro.' };
    if (profundidad != null && intervalo.hasta_m > profundidad)
      return { permitido: false, mensaje: `Corrija los intervalos que exceden ${profundidad} m antes de agregar otro.` };
    if (indice > 0 && intervalo.desde_m < ordenados[indice - 1].hasta_m)
      return { permitido: false, mensaje: 'Corrija el solapamiento antes de agregar otro intervalo.' };
  }
  const desde_m = ordenados[ordenados.length - 1].hasta_m;
  if (profundidad != null && desde_m >= profundidad)
    return { permitido: false, mensaje: 'El último intervalo ya alcanza la profundidad final.' };
  return { permitido: true, desde_m };
}

export function validarDatosTecnicos(datos: DatosTecnicosBorrador, profundidad?: number): string[] {
  const errores: string[] = [];
  validarIntervalos(datos.intervalosLitologicos.map((item) => item.dato), 'litológico', profundidad, errores);
  validarIntervalos(datos.intervalosDiametro.map((item) => item.dato), 'de diámetro', profundidad, errores);
  datos.nivelesAporte.forEach((item, indice) => {
    if (!Number.isFinite(item.dato.profundidad_m) || item.dato.profundidad_m < 0)
      errores.push(`Aporte ${indice + 1}: profundidad inválida.`);
    else if (profundidad != null && item.dato.profundidad_m > profundidad)
      errores.push(`Aporte ${indice + 1}: excede ${profundidad} m.`);
  });
  return errores;
}

function validarIntervalos(
  intervalos: ReadonlyArray<{ desde_m: number; hasta_m: number }>,
  nombre: string,
  profundidad: number | undefined,
  errores: string[],
) {
  const ordenados = [...intervalos].sort((a, b) => a.desde_m - b.desde_m || a.hasta_m - b.hasta_m);
  ordenados.forEach((intervalo, indice) => {
    if (!Number.isFinite(intervalo.desde_m) || intervalo.desde_m < 0)
      errores.push(`Intervalo ${nombre} ${indice + 1}: desde debe ser mayor o igual a 0.`);
    if (!Number.isFinite(intervalo.hasta_m) || intervalo.hasta_m <= intervalo.desde_m)
      errores.push(`Intervalo ${nombre} ${indice + 1}: hasta debe ser mayor que desde.`);
    if (profundidad != null && intervalo.hasta_m > profundidad)
      errores.push(`Intervalo ${nombre} ${indice + 1}: excede ${profundidad} m.`);
    if (indice > 0 && intervalo.desde_m < ordenados[indice - 1].hasta_m)
      errores.push(`Los intervalos ${nombre} ${indice} y ${indice + 1} se solapan.`);
  });
}

export function ordenarDatosTecnicos(datos: DatosTecnicosBorrador): DatosTecnicosBorrador {
  return {
    intervalosLitologicos: [...datos.intervalosLitologicos].sort((a, b) => a.dato.desde_m - b.dato.desde_m),
    intervalosDiametro: [...datos.intervalosDiametro].sort((a, b) => a.dato.desde_m - b.dato.desde_m),
    nivelesAporte: [...datos.nivelesAporte].sort((a, b) => a.dato.profundidad_m - b.dato.profundidad_m),
  };
}
