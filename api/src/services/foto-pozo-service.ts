import { myPool } from "../db/pool.ts";
import * as err from "../models/errors.ts";
import { aislarFotoExistente, purgarFotoConfirmada, restaurarFotoAislada, type LoggerPurga } from "./foto-archivo-service.ts";

interface DbFoto {
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export async function eliminarFotoPersistida(
  idPozo: number,
  directorio: string,
  db: DbFoto = myPool,
  opciones: { logger?: LoggerPurga; eliminarPostCommit?: (ruta: string) => Promise<void> } = {},
): Promise<{ archivoExistia: boolean }> {
  const fotoAislada = await aislarFotoExistente(idPozo, directorio);
  try {
    const { rows } = await db.query(
      `UPDATE public.pozo SET foto_url = NULL WHERE id_pozo = $1
       RETURNING id_pozo`,
      [idPozo],
    );
    if (!rows[0]) throw new err.T05PozoNoEncontrado();
  } catch (error) {
    await restaurarFotoAislada(fotoAislada);
    throw error;
  }
  await purgarFotoConfirmada(fotoAislada,idPozo,"eliminar_foto",opciones.logger,opciones.eliminarPostCommit);
  return { archivoExistia: Boolean(fotoAislada) };
}
