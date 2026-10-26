import { DatosTecnicosBorrador, ElementoBorrador, NuevoPozo, SitioBody } from '../types/schemas';

export type EstadoPerforacion = { pozo: NuevoPozo; sitio: SitioBody; tecnicos: DatosTecnicosBorrador };

// Incorporar lo confirmado por el servidor sin sobrescribir ediciones posteriores
// al envío. La identidad de una fila persistida siempre procede de la recarga.
export function reconciliarPerforacion(enviado: EstadoPerforacion, actual: EstadoPerforacion, canonico: EstadoPerforacion): EstadoPerforacion {
  return {
    pozo: { ...conservarEdiciones(enviado.pozo, actual.pozo, canonico.pozo), foto_url: canonico.pozo.foto_url },
    sitio: conservarEdiciones(enviado.sitio, actual.sitio, canonico.sitio),
    tecnicos: reconciliarDatosTecnicos(enviado.tecnicos, actual.tecnicos, canonico.tecnicos),
  };
}

export function reconciliarDatosTecnicos(enviado: DatosTecnicosBorrador, actual: DatosTecnicosBorrador, canonico: DatosTecnicosBorrador): DatosTecnicosBorrador {
  return {
    prefiltro_constructivo: JSON.stringify(actual.prefiltro_constructivo) === JSON.stringify(enviado.prefiltro_constructivo)
      ? structuredClone(canonico.prefiltro_constructivo) : structuredClone(actual.prefiltro_constructivo),
    sello_sanitario_constructivo: JSON.stringify(actual.sello_sanitario_constructivo ?? null) === JSON.stringify(enviado.sello_sanitario_constructivo ?? null)
      ? structuredClone(canonico.sello_sanitario_constructivo ?? null) : structuredClone(actual.sello_sanitario_constructivo ?? null),
    intervalosLitologicos: reconciliarFilas(enviado.intervalosLitologicos, actual.intervalosLitologicos, canonico.intervalosLitologicos),
    intervalosDiametro: reconciliarFilas(enviado.intervalosDiametro, actual.intervalosDiametro, canonico.intervalosDiametro),
    intervalosFiltro: reconciliarFilas(enviado.intervalosFiltro, actual.intervalosFiltro, canonico.intervalosFiltro),
    nivelesAporte: reconciliarFilas(enviado.nivelesAporte, actual.nivelesAporte, canonico.nivelesAporte),
  };
}

function conservarEdiciones<T extends object>(enviado: T, actual: T, canonico: T): T {
  const resultado = { ...canonico };
  for (const key of new Set([...Object.keys(enviado), ...Object.keys(actual)]) as Set<keyof T>) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(enviado[key])) resultado[key] = actual[key];
  }
  return resultado;
}

function reconciliarFilas<T extends object>(enviadas: ElementoBorrador<T>[], actuales: ElementoBorrador<T>[], canonicas: ElementoBorrador<T>[]): ElementoBorrador<T>[] {
  const disponibles = [...canonicas];
  const persistidas = new Map<string, ElementoBorrador<T>>();
  for (const enviada of enviadas) {
    // Los intervalos válidos no se solapan. Para aportes repetidos se consume
    // una coincidencia por fila; no se adivinan IDs mediante el orden de la API.
    const indice = disponibles.findIndex(fila => mismaPosicion(enviada.dato, fila.dato));
    if (indice < 0) throw new Error('No se pudieron reconciliar los datos técnicos guardados. Reintentá la actualización.');
    persistidas.set(enviada.idLocal, disponibles.splice(indice, 1)[0]);
  }
  if (disponibles.length) throw new Error('Los datos técnicos cambiaron en el servidor. Reintentá la actualización.');
  return actuales.map(actual => {
    const enviada = enviadas.find(fila => fila.idLocal === actual.idLocal);
    const persistida = persistidas.get(actual.idLocal);
    if (!enviada || !persistida) return structuredClone(actual);
    const dato = conservarEdiciones(enviada.dato, actual.dato, persistida.dato);
    for (const key of ['id_intervalo_litologico', 'id_intervalo_filtro'] as const) {
      if (key in persistida.dato) Object.assign(dato, { [key]: Reflect.get(persistida.dato, key) });
    }
    return { ...persistida, idLocal: actual.idLocal, dato };
  });
}

function mismaPosicion(a: object, b: object): boolean {
  if ('desde_m' in a && 'hasta_m' in a && 'desde_m' in b && 'hasta_m' in b)
    return a.desde_m === b.desde_m && a.hasta_m === b.hasta_m;
  return 'profundidad_m' in a && 'profundidad_m' in b && a.profundidad_m === b.profundidad_m;
}
