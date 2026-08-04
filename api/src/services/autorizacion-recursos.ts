import type { Pool, PoolClient } from "pg";
import { myPool } from "../db/pool.ts";

type Db = Pick<Pool | PoolClient, "query">;

export async function pozoPerteneceAUsuario(
  idPozo: number,
  idUsuario: number,
  db: Db = myPool
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1
       FROM public.pozo p
      WHERE p.id_pozo = $1
        AND p.id_propietario = $2`,
    [idPozo, idUsuario]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function pozoPerteneceAPerforador(
  idPozo: number,
  idUsuario: number,
  db: Db = myPool
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM public.pozo p WHERE p.id_pozo = $1 AND p.id_perforador = $2`,
    [idPozo, idUsuario]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function sitioEsVisibleParaPropietario(
  idSitio: number,
  idUsuario: number,
  db: Db = myPool
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1
       FROM public.pozo p
      WHERE p.id_sitio = $1
        AND p.id_propietario = $2
      LIMIT 1`,
    [idSitio, idUsuario]
  );
  return (result.rowCount ?? 0) > 0;
}
