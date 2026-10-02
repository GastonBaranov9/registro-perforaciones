import type { Pool, PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import * as err from "../models/errors.ts";
import { validarPersonaPozo } from "./candidatos-pozo-service.ts";

type Propiedad = { id_propietario: number | null; propietario_provisional?: string | null };
export function normalizarPropiedad(data: Propiedad): string | null {
  const nombre = data.propietario_provisional?.trim() || null;
  if (data.id_propietario === null) {
    if (!nombre || nombre.length > 160) throw new err.T05DatosIncorrectos("Indique un nombre provisional de hasta 160 caracteres.");
    return nombre;
  }
  if (!Number.isSafeInteger(data.id_propietario) || data.id_propietario <= 0 || nombre)
    throw new err.T05DatosIncorrectos("Seleccione un propietario real o indique un nombre provisional, exclusivamente.");
  return null;
}

export async function validarPropiedad(data: Propiedad, db: Pick<PoolClient, "query">): Promise<string | null> {
  const nombre = normalizarPropiedad(data);
  if (data.id_propietario !== null) await validarPersonaPozo(data.id_propietario, "propietario", db);
  return nombre;
}

// Operación limitada a la referencia del propietario: nunca reescribe datos técnicos ni archivos.
export async function vincularPropietarioPozo(idPozo: number, idPropietario: number, esperado: number | null, actor: number, pool: Pick<Pool, "connect"> = myPool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const admin = await client.query(
      "SELECT u.id_usuario FROM usuario u WHERE u.id_usuario=$1 AND u.activo AND u.cuenta_acceso AND EXISTS (SELECT 1 FROM usuario_rol ur JOIN rol r ON r.id_rol=ur.id_rol WHERE ur.id_usuario=u.id_usuario AND r.nombre='administracion')", [actor]);
    if (!admin.rows[0]) throw new err.T05SinPermiso();
    await client.query("SELECT pg_advisory_xact_lock($1::integer, 606)", [idPozo]);
    const actual = await client.query("SELECT id_propietario FROM pozo WHERE id_pozo=$1 FOR UPDATE", [idPozo]);
    if (!actual.rows[0]) throw new err.T05PozoNoEncontrado();
    const anterior = actual.rows[0].id_propietario == null ? null : Number(actual.rows[0].id_propietario);
    if (anterior !== esperado) throw new err.T05DatosIncorrectos("El propietario cambió. Recargue el pozo antes de vincular.");
    await validarPersonaPozo(idPropietario, "propietario", client);
    await client.query("UPDATE pozo SET id_propietario=$2, propietario_provisional=NULL WHERE id_pozo=$1", [idPozo, idPropietario]);
    await client.query("COMMIT");
    return { id_pozo: idPozo, id_propietario: idPropietario, propietario_provisional: null };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
