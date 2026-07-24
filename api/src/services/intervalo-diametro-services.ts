import { myPool } from "../db/pool.ts";
import type {
  IntervaloDiametroPerforacion,
  IntervaloDiametroPerforacionBody,
} from "../models/schemas.ts";
import * as err from "../models/errors.ts";
export async function createIntervaloDiametro(
  id_pozo: number,
  data: IntervaloDiametroPerforacionBody
): Promise<IntervaloDiametroPerforacion> {
  const sql = `
    INSERT INTO intervalo_diametro_perforacion
      (id_pozo, desde_m, hasta_m, diametro_pulg)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  try {
    const { rows } = await myPool.query(sql, [
      id_pozo,
      data.desde_m,
      data.hasta_m,
      data.diametro_pulg,
    ]);
    return rows[0] as IntervaloDiametroPerforacion;
  } catch (e: any) {
    if (e.code === "23514") {
      throw new err.T05DatosIncorrectos(
        "Validación: 'hasta_m' debe ser mayor que 'desde_m'."
      );
    }
    if (e.code === "23503") {
      throw new err.T05PozoNoEncontrado("El pozo indicado no existe.");
    }
    throw e;
  }
}

export async function updateIntervaloDiametro(
  id_pozo: number,
  id_intervalo: number,
  data: IntervaloDiametroPerforacionBody
): Promise<IntervaloDiametroPerforacion | null> {
  const exists = await myPool.query(
    `SELECT 1 FROM intervalo_diametro_perforacion WHERE id_intervalo_diametro_perforacion = $1 AND id_pozo = $2`,
    [id_intervalo, id_pozo]
  );
  if (!exists.rows[0]) return null;

  const sql = `
    UPDATE intervalo_diametro_perforacion
    SET
      desde_m = $3,
      hasta_m = $4,
      diametro_pulg = $5
    WHERE id_intervalo_diametro_perforacion = $1
      AND id_pozo = $2
    RETURNING *;
  `;
  try {
    const { rows } = await myPool.query(sql, [
      id_intervalo,
      id_pozo,
      data.desde_m,
      data.hasta_m,
      data.diametro_pulg,
    ]);
    return rows[0] ?? null;
  } catch (e: any) {
    if (e.code === "23514") {
      throw new Error("Validación: 'hasta_m' debe ser mayor que 'desde_m'.");
    }
    throw e;
  }
}

export async function deleteIntervaloDiametro(
  id_pozo: number,
  id_intervalo: number
): Promise<boolean> {
  const { rowCount } = await myPool.query(
    `
    DELETE FROM intervalo_diametro_perforacion
    WHERE id_intervalo_diametro_perforacion = $1
      AND id_pozo = $2
    `,
    [id_intervalo, id_pozo]
  );
  return (rowCount ?? 0) > 0;
}

export async function getIntervaloDiametroById(
  id_pozo: number,
  id_intervalo: number
): Promise<IntervaloDiametroPerforacion | null> {
  const { rows } = await myPool.query(
    `
    SELECT *
    FROM intervalo_diametro_perforacion
    WHERE id_intervalo_diametro_perforacion = $1
      AND id_pozo = $2
    `,
    [id_intervalo, id_pozo]
  );
  return rows[0] ?? null;
}

export async function listIntervalosDiametroByPozo(
  id_pozo: number
): Promise<IntervaloDiametroPerforacion[]> {
  const { rows } = await myPool.query(
    `
    SELECT
      id_intervalo_diametro_perforacion AS id_intervalo_diametro_perforacion,
      id_pozo                              AS id_pozo,
      desde_m                              AS desde_m,
      hasta_m                              AS hasta_m,
      diametro_pulg                        AS diametro_pulg
    FROM intervalo_diametro_perforacion
    WHERE id_pozo = $1
    ORDER BY desde_m
    `,
    [id_pozo]
  );
  return rows as IntervaloDiametroPerforacion[];
}
