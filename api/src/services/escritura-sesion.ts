import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import { T05NoAutorizado } from "../models/errors.ts";
import { exigirEdicionPozo, exigirEdicionSitio } from "./edicion-pozo.ts";

interface SesionEscritura {
  idUsuario: number;
  versionSesion: number;
  idSesionNativa?: number;
  expiresAt?: number;
  idPozo?: number;
  idSitio?: number;
}

// Identity propagation only: never an ambient/disconnected transaction.
export const contextoEscritura = new AsyncLocalStorage<SesionEscritura>();
const protegidos = new WeakMap<object, SesionEscritura>();

/** Start on the operation's connection, before any domain/file mutation.
 * Lock order: administration gate -> actor -> native session -> domain resources.
 * The shared gate permits concurrent domain writes. Account/role mutations take
 * it exclusively, preventing actor/target lock inversions across administrators.
 */
export async function iniciarEscrituraSesion(client: Pick<PoolClient, "query">, administrativa = false): Promise<void> {
  protegidos.delete(client);
  await client.query("BEGIN");
  const sesion = contextoEscritura.getStore();
  if (!sesion) {
    // Internal administrative callers must serialize with HTTP account mutations too.
    if (administrativa) await client.query("SELECT pg_advisory_xact_lock(731024, 1)");
    return;
  }
  await client.query(administrativa
    ? "SELECT pg_advisory_xact_lock(731024, 1)"
    : "SELECT pg_advisory_xact_lock_shared(731024, 1)");
  const { rows } = await client.query(
    `SELECT activo, cuenta_acceso, version_sesion FROM usuario
     WHERE id_usuario = $1 FOR SHARE /* session-write-user-lock */`,
    [sesion.idUsuario],
  );
  const usuario = rows[0];
  if (!usuario?.activo || !usuario.cuenta_acceso || Number(usuario.version_sesion) !== sesion.versionSesion
      || (sesion.expiresAt !== undefined && sesion.expiresAt <= Date.now())) throw new T05NoAutorizado();
  if (sesion.idSesionNativa !== undefined) {
    const nativa = await client.query(
      `SELECT id_sesion_nativa FROM sesion_nativa
       WHERE id_sesion_nativa=$1 AND id_usuario=$2 AND version_sesion_emitida=$3
         AND revoked_at IS NULL AND expires_at > clock_timestamp()
       FOR SHARE /* session-write-native-lock */`,
      [sesion.idSesionNativa, sesion.idUsuario, sesion.versionSesion],
    );
    if (!nativa.rows[0]) throw new T05NoAutorizado();
  }
  // Recheck the time window after waiting for transaction locks.
  if (sesion.idPozo || sesion.idSitio) {
    const admin = await client.query(
      `SELECT 1 FROM usuario_rol ur JOIN rol r ON ur.id_rol=r.id_rol
       WHERE ur.id_usuario=$1 AND LOWER(r.nombre)=LOWER($2)`,
      [sesion.idUsuario, "administracion"],
    );
    if (!admin.rows.length) {
      if (sesion.idPozo) await exigirEdicionPozo(sesion.idPozo, sesion.idUsuario, client);
      if (sesion.idSitio) await exigirEdicionSitio(sesion.idSitio, sesion.idUsuario, client);
    }
  }
  protegidos.set(client, sesion);
}

/** Give formerly autocommit operations one protected transaction. An explicitly
 * supplied client is reused only when already protected by this same identity.
 */
export async function conEscrituraSesion<T, Db extends object>(
  operacion: (db: Db) => Promise<T>, db: Db, administrativa = false,
): Promise<T> {
  const sesion = contextoEscritura.getStore();
  if (!sesion) return operacion(db);
  if (db !== myPool) {
    if (protegidos.get(db) !== sesion) throw new Error("La conexión de escritura no tiene una transacción de sesión protegida.");
    return operacion(db);
  }
  const client = await myPool.connect();
  let descartar = false;
  try {
    await iniciarEscrituraSesion(client, administrativa);
    const resultado = await operacion(client as unknown as Db);
    await client.query("COMMIT");
    return resultado;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { descartar = true; }
    throw error;
  } finally {
    protegidos.delete(client);
    client.release(descartar);
  }
}
