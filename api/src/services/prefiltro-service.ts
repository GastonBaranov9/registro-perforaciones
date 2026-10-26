import type { PoolClient } from 'pg';
import { Value } from '@sinclair/typebox/value';
import { PrefiltroConstructivo, type IntervaloPrefiltro } from '../models/schemas.ts';
import { T05DatosIncorrectos } from '../models/errors.ts';

type Db = Pick<PoolClient, 'query'>;

export function validarPrefiltro(intervalos: IntervaloPrefiltro[] | null | undefined, profundidad?: number | null): void {
  if (intervalos == null) return;
  if (!Value.Check(PrefiltroConstructivo, intervalos)) throw new T05DatosIncorrectos('Prefiltro: colección de intervalos inválida.');
  const ordenados = [...intervalos].sort((a, b) => a.desde_m - b.desde_m);
  for (const [i, tramo] of ordenados.entries()) {
    if (!Number.isFinite(tramo.desde_m) || !Number.isFinite(tramo.hasta_m) || tramo.desde_m < 0 || tramo.desde_m >= tramo.hasta_m)
      throw new T05DatosIncorrectos('Prefiltro: requiere 0 <= Desde < Hasta y números finitos.');
    if (profundidad == null || !Number.isFinite(profundidad) || tramo.hasta_m > profundidad)
      throw new T05DatosIncorrectos('Prefiltro: indique una profundidad final que contenga todos los intervalos.');
    if (i > 0 && tramo.desde_m < ordenados[i - 1].hasta_m)
      throw new T05DatosIncorrectos('Prefiltro: los intervalos no pueden duplicarse ni solaparse.');
  }
}

export async function obtenerPrefiltro(db: Db, idPozo: number): Promise<IntervaloPrefiltro[]> {
  const { rows } = await db.query('SELECT desde_m,hasta_m FROM prefiltro_pozo WHERE id_pozo=$1 ORDER BY desde_m', [idPozo]);
  return rows.map(r => ({ desde_m: Number(r.desde_m), hasta_m: Number(r.hasta_m) }));
}

/** El llamador mantiene la transacción y el bloqueo del pozo. Omitido conserva;
 * null/[] elimina; una colección válida reemplaza íntegramente. */
export async function guardarPrefiltro(db: Db, idPozo: number, intervalos: IntervaloPrefiltro[] | null | undefined, profundidad?: number | null): Promise<IntervaloPrefiltro[]> {
  const efectivos = intervalos === undefined ? await obtenerPrefiltro(db, idPozo) : intervalos ?? [];
  validarPrefiltro(efectivos, profundidad);
  if (intervalos !== undefined) {
    await db.query('DELETE FROM prefiltro_pozo WHERE id_pozo=$1', [idPozo]);
    for (const tramo of efectivos)
      await db.query('INSERT INTO prefiltro_pozo(id_pozo,desde_m,hasta_m) VALUES($1,$2,$3)', [idPozo, tramo.desde_m, tramo.hasta_m]);
  }
  return [...efectivos].sort((a, b) => a.desde_m - b.desde_m);
}
