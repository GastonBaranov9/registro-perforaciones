import fs from "node:fs/promises";
import path from "node:path";
import { myPool } from "../db/pool.ts";
import * as err from "../models/errors.ts";

interface DbFoto {
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export async function eliminarFotoPersistida(
  idPozo: number,
  directorio: string,
  db: DbFoto = myPool,
): Promise<{ archivoExistia: boolean }> {
  await fs.mkdir(directorio, { recursive: true });
  const archivos = await fs.readdir(directorio);
  const nombre = archivos.find((archivo) => /^pozo-\d+\.(?:jpe?g|png)$/i.test(archivo) && archivo.startsWith(`pozo-${idPozo}.`));
  const papelera = path.join(directorio, ".trash");
  const original = nombre ? path.join(directorio, nombre) : null;
  const aislado = nombre ? path.join(papelera, `${idPozo}-${Date.now()}-${nombre}`) : null;
  if (original && aislado) {
    await fs.mkdir(papelera, { recursive: true });
    await fs.rename(original, aislado);
  }
  try {
    const { rows } = await db.query(
      `UPDATE public.pozo SET foto_url = NULL WHERE id_pozo = $1
       RETURNING id_pozo`,
      [idPozo],
    );
    if (!rows[0]) throw new err.T05PozoNoEncontrado();
  } catch (error) {
    if (original && aislado) await fs.rename(aislado, original);
    throw error;
  }
  if (aislado) {
    try {
      await fs.rm(aislado);
    } catch (error) {
      throw new err.T05ErrorDesconocido("La fotografía quedó inaccesible, pero no se pudo purgar el archivo aislado.", { cause: error });
    }
  }
  return { archivoExistia: Boolean(nombre) };
}
