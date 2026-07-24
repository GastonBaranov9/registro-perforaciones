import { myPool } from "../db/pool.ts";
import {
  CaracteristicasConstructivas,
  Informe,
  InformeBody,
  IntervaloLitologico,
} from "../models/schemas.ts";
import * as err from "../models/errors.ts";

export async function getInforme(id_pozo: number): Promise<Informe | null> {
  const { rows } = await myPool.query(
    `
    SELECT *
    FROM informe
    WHERE id_perforacion = $1
    `,
    [id_pozo]
  );

  return rows[0] ?? null;
}

export async function getCaracteristicasConstructivas(
  id_pozo: number
): Promise<CaracteristicasConstructivas> {
  const { rows } = await myPool.query(
    `
    SELECT *
    FROM caracteristicas_constructivas
    WHERE id_pozo = $1
    `,
    [id_pozo]
  );

  return rows[0] ?? null;
}
