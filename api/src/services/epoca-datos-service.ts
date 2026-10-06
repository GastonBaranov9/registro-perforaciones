import type { PoolClient } from 'pg';
import { myPool } from '../db/pool.ts';
import { T05EpocaRetirada, T05DatosIncorrectos } from '../models/errors.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validarClaveOperacion(clave: unknown): asserts clave is string {
  if (typeof clave !== 'string' || !uuid.test(clave)) throw new T05DatosIncorrectos('La clave de operación debe ser un UUID v4.');
}
export async function obtenerEpoca(db: Pick<PoolClient, 'query'> = myPool): Promise<string> {
  const { rows } = await db.query('SELECT epoca FROM public.epoca_datos WHERE singleton=TRUE');
  if (!rows[0]) throw new Error('Falta la época de datos');
  return rows[0].epoca;
}
// Siempre dentro de la transacción, después de validar sesión/rol y antes del
// lock UUID o de leer un recibo. El corte toma este mismo registro FOR UPDATE.
export async function exigirEpoca(db: Pick<PoolClient, 'query'>, epoca: unknown): Promise<string> {
  if (typeof epoca !== 'string' || !uuid.test(epoca)) throw new T05EpocaRetirada();
  const { rows } = await db.query('SELECT epoca FROM public.epoca_datos WHERE singleton=TRUE FOR SHARE');
  if (!rows[0] || rows[0].epoca !== epoca.toLowerCase()) throw new T05EpocaRetirada();
  return rows[0].epoca;
}
