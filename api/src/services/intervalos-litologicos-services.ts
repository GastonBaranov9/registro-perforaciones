import { myPool } from "../db/pool.ts";
import * as err from "../models/errors.ts";

export async function createIntervaloLitologico(
  id_pozo: number,
  data: Record<string, any>
) {
  const sql = `
    WITH bloqueo AS (SELECT pg_advisory_xact_lock($1))
    INSERT INTO intervalo_litologico
      (id_pozo, desde_m, hasta_m, material)
    SELECT $1, $2, $3, $4
    FROM bloqueo
    WHERE NOT EXISTS (
      SELECT 1 FROM intervalo_litologico
      WHERE id_pozo = $1 AND desde_m < $3 AND hasta_m > $2
    )
    RETURNING *;
  `;
  try {
    const { rows } = await myPool.query(sql, [
      id_pozo,
      data.desde_m,
      data.hasta_m,
      data.material,
    ]);
    if (!rows[0]) throw new err.T05DatosIncorrectos("El intervalo se solapa con otro existente.");
    return rows[0];
  } catch (e: any) {
    if (e.code === "23514")
      throw new err.T05DatosIncorrectos("Validación fallida.");
    if (e.code === "23503")
      throw new err.T05PozoNoEncontrado("El pozo indicado no existe.");
    if (e.code && e.code.startsWith("23")) {
      throw new err.T05DatosIncorrectos("Error de integridad de datos.");
    }
    e.statusCode = 500;
    e.message = `DB error: ${e.message}`;
    throw e;
  }
}

export async function updateIntervaloLitologico(
  id_pozo: number,
  id_intervalo_litologico: number,
  data: Record<string, any>
) {
  const exists = await myPool.query(
    `SELECT 1 FROM intervalo_litologico
     WHERE id_intervalo_litologico = $1 AND id_pozo = $2`,
    [id_intervalo_litologico, id_pozo]
  );
  if (!exists.rows[0]) return null;

  const sql = `
    WITH bloqueo AS (SELECT pg_advisory_xact_lock($2))
    UPDATE intervalo_litologico AS actual
    SET
      desde_m = $3,
      hasta_m = $4,
      material = $5
    FROM bloqueo
    WHERE actual.id_intervalo_litologico = $1 AND actual.id_pozo = $2
      AND NOT EXISTS (
        SELECT 1 FROM intervalo_litologico AS otro
        WHERE otro.id_pozo = $2
          AND otro.id_intervalo_litologico <> $1
          AND otro.desde_m < $4
          AND otro.hasta_m > $3
      )
    RETURNING *;
  `;
  const { rows } = await myPool.query(sql, [
    id_intervalo_litologico,
    id_pozo,
    data.desde_m,
    data.hasta_m,
    data.material,
  ]);
  if (!rows[0]) throw new err.T05DatosIncorrectos("El intervalo se solapa con otro existente.");
  return rows[0];
}

export async function deleteIntervaloLitologico(
  id_pozo: number,
  id_intervalo_litologico: number
) {
  const { rowCount } = await myPool.query(
    `DELETE FROM intervalo_litologico
     WHERE id_intervalo_litologico = $1 AND id_pozo = $2`,
    [id_intervalo_litologico, id_pozo]
  );
  return (rowCount ?? 0) > 0;
}
export async function getIntervaloLitologicoById(
  id_pozo: number,
  id_intervalo_litologico: number
) {
  const { rows } = await myPool.query(
    `SELECT * FROM intervalo_litologico
     WHERE id_intervalo_litologico = $1 AND id_pozo = $2`,
    [id_intervalo_litologico, id_pozo]
  );
  return rows[0] ?? null;
}

export async function listIntervalosLitologicosByPozo(id_pozo: number) {
  const { rows } = await myPool.query(
    `SELECT * FROM intervalo_litologico
     WHERE id_pozo = $1
     ORDER BY desde_m`,
    [id_pozo]
  );
  return rows;
}
