import { T05DatosIncorrectos } from '../models/errors.ts';

type Rango = { desde_m: number; hasta_m: number };
type Diametro = Rango & { sin_tuberia?: boolean; material_tuberia: unknown };
type Db = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

export function errorMaterialDiametro(dato: Diametro): string | null {
  if (dato.sin_tuberia !== undefined && typeof dato.sin_tuberia !== 'boolean')
    return 'El estado sin_tuberia debe ser booleano.';
  if (dato.sin_tuberia === true)
    return dato.material_tuberia === null ? null : 'Un intervalo sin cañería no admite material de tubería.';
  return dato.material_tuberia === 'PVC' || dato.material_tuberia === 'Acero'
    ? null : 'material inválido.';
}

export function hayFiltroSinTuberia(diametros: readonly Diametro[], filtros: readonly Rango[]): boolean {
  return diametros.some(d => d.sin_tuberia === true
    && filtros.some(f => f.desde_m < d.hasta_m && f.hasta_m > d.desde_m));
}

/** Mismo bloqueo de pozo que la edición completa/histórica; la consulta posterior
 * ve las escrituras confirmadas mientras se esperaba el bloqueo (READ COMMITTED). */
export async function exigirCompatibilidadEntubamiento(db: Db, idPozo: number, rango: Rango, tipo: 'abierto' | 'filtro') {
  await db.query('SELECT id_pozo FROM pozo WHERE id_pozo=$1 FOR UPDATE', [idPozo]);
  const sql = tipo === 'abierto'
    ? 'SELECT 1 FROM intervalo_filtro WHERE id_pozo=$1 AND desde_m<$3 AND hasta_m>$2 LIMIT 1'
    : 'SELECT 1 FROM intervalo_diametro_perforacion WHERE id_pozo=$1 AND sin_tuberia AND desde_m<$3 AND hasta_m>$2 LIMIT 1';
  const { rows } = await db.query(sql, [idPozo, rango.desde_m, rango.hasta_m]);
  if (rows.length) throw new T05DatosIncorrectos('Un filtro no puede solaparse con una perforación sin cañería.');
}
