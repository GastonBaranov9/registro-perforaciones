import type { PoolClient } from 'pg';
import { Value } from '@sinclair/typebox/value';
import { SelloSanitarioConstructivo } from '../models/schemas.ts';
import { T05DatosIncorrectos } from '../models/errors.ts';

type Db = Pick<PoolClient, 'query'>;

export function validarSelloSanitario(sello: SelloSanitarioConstructivo | null | undefined, profundidad?: number | null): void {
  if (sello == null) return;
  if (!Value.Check(SelloSanitarioConstructivo, sello) || !Number.isFinite(sello.desde_m)
      || !Number.isFinite(sello.hasta_m) || sello.desde_m >= sello.hasta_m)
    throw new T05DatosIncorrectos('El sello sanitario constructivo requiere 0 <= desde_m < hasta_m y valores finitos.');
  if (profundidad != null && sello.hasta_m > profundidad)
    throw new T05DatosIncorrectos('El sello sanitario constructivo excede la profundidad final.');
}

export async function obtenerSelloSanitario(db: Db, idPozo: number): Promise<SelloSanitarioConstructivo | null> {
  const { rows } = await db.query('SELECT desde_m,hasta_m FROM sello_sanitario_pozo WHERE id_pozo=$1', [idPozo]);
  return rows[0] ? { desde_m: Number(rows[0].desde_m), hasta_m: Number(rows[0].hasta_m) } : null;
}

export async function guardarSelloSanitario(db: Db, idPozo: number, sello: SelloSanitarioConstructivo | null | undefined, profundidad?: number | null): Promise<SelloSanitarioConstructivo | null> {
  const efectivo = sello === undefined ? await obtenerSelloSanitario(db, idPozo) : sello;
  validarSelloSanitario(efectivo, profundidad);
  if (sello === null) await db.query('DELETE FROM sello_sanitario_pozo WHERE id_pozo=$1', [idPozo]);
  else if (sello !== undefined) await db.query(`INSERT INTO sello_sanitario_pozo(id_pozo,desde_m,hasta_m)
    VALUES($1,$2,$3) ON CONFLICT(id_pozo) DO UPDATE SET desde_m=EXCLUDED.desde_m,hasta_m=EXCLUDED.hasta_m`,
    [idPozo, sello.desde_m, sello.hasta_m]);
  return efectivo;
}
