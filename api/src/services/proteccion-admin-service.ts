import type { PoolClient } from 'pg';
import { T05SinPermiso } from '../models/errors.ts';

/** Call before COMMIT, holding the exclusive administration gate acquired at BEGIN.
 * Checking the resulting state also covers role deletion/rename and multi-role edits.
 */
export async function exigirAdministradorActivo(db: Pick<PoolClient, 'query'>) {
  const { rows } = await db.query(`SELECT TRUE AS sin_administrador WHERE NOT EXISTS (
    SELECT 1 FROM usuario u JOIN usuario_rol ur ON ur.id_usuario=u.id_usuario
    JOIN rol r ON r.id_rol=ur.id_rol
    WHERE u.activo AND u.cuenta_acceso AND lower(r.nombre)='administracion'
  ) /* last-active-administrator */`);
  if (rows.some(row => row.sin_administrador === true))
    throw new T05SinPermiso('La operación dejaría al sistema sin administradores activos con acceso. Mantenga al menos uno.');
}
