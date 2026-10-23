import { conEscrituraSesion } from "./escritura-sesion.ts";
import { myPool } from "../db/pool.ts";
import type {
  IntervaloDiametroPerforacion,
  IntervaloDiametroPerforacionBody,
} from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { errorMaterialDiametro, exigirCompatibilidadEntubamiento } from "./compatibilidad-entubamiento.ts";
interface ConsultasDiametro { query(text:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[]}> }
export async function createIntervaloDiametro(
  id_pozo: number,
  data: IntervaloDiametroPerforacionBody,
  db: ConsultasDiametro = myPool,
): Promise<IntervaloDiametroPerforacion> {
  return conEscrituraSesion(async (dbEscritura) => {
    validarDatoDiametro(data);
    if (data.sin_tuberia === true) await exigirCompatibilidadEntubamiento(dbEscritura, id_pozo, data, 'abierto');
    const sql = `
      WITH bloqueo AS (SELECT pg_advisory_xact_lock($1::integer, 608))
      INSERT INTO intervalo_diametro_perforacion (id_pozo, desde_m, hasta_m, diametro_pulg, material_tuberia, sin_tuberia)
      SELECT $1, $2, $3, $4, $5, $6 FROM bloqueo JOIN pozo p ON p.id_pozo=$1
      WHERE (p.profundidad_final_m IS NULL OR $3<=p.profundidad_final_m)
        AND NOT EXISTS (SELECT 1 FROM intervalo_diametro_perforacion d WHERE d.id_pozo=$1 AND d.desde_m<$3 AND d.hasta_m>$2)
      RETURNING id_intervalo_diametro_perforacion,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,sin_tuberia;
    `;
    try {
      const { rows } = await dbEscritura.query(sql, [
        id_pozo,
        data.desde_m,
        data.hasta_m,
        data.diametro_pulg,
        data.material_tuberia,
        data.sin_tuberia === true,
      ]);
      if (!rows[0]) throw new err.T05DatosIncorrectos("El intervalo se solapa o excede la profundidad final.");
      return rows[0] as IntervaloDiametroPerforacion;
    } catch (e: unknown) {
      const codigo = codigoPg(e);
      if (codigo === "23514") {
        throw new err.T05DatosIncorrectos(
          "Validación: 'hasta_m' debe ser mayor que 'desde_m'."
        );
      }
      if (codigo === "23503") {
        throw new err.T05PozoNoEncontrado("El pozo indicado no existe.");
      }
      throw e;
    }
  }, db, false);
}

export async function updateIntervaloDiametro(
  id_pozo: number,
  id_intervalo: number,
  data: IntervaloDiametroPerforacionBody,
  db: ConsultasDiametro = myPool,
): Promise<IntervaloDiametroPerforacion | null> {
  return conEscrituraSesion(async (dbEscritura) => {
    validarDatoDiametro(data);
    const exists = await dbEscritura.query(
      `SELECT id_intervalo_diametro_perforacion FROM intervalo_diametro_perforacion WHERE id_intervalo_diametro_perforacion = $1 AND id_pozo = $2`,
      [id_intervalo, id_pozo]
    );
    if (!exists.rows[0]) return null;
    if (data.sin_tuberia === true) await exigirCompatibilidadEntubamiento(dbEscritura, id_pozo, data, 'abierto');
    const pozo=await dbEscritura.query("SELECT profundidad_final_m FROM pozo WHERE id_pozo=$1",[id_pozo]);
    if(!pozo.rows[0])return null;
    const profundidad=pozo.rows[0].profundidad_final_m==null?null:Number(pozo.rows[0].profundidad_final_m);
    if(profundidad!==null&&data.hasta_m>profundidad)throw new err.T05DatosIncorrectos("El intervalo de diámetro excede la profundidad final.");
    const solapado=await dbEscritura.query("SELECT id_intervalo_diametro_perforacion FROM intervalo_diametro_perforacion WHERE id_pozo=$1 AND id_intervalo_diametro_perforacion<>$2 AND desde_m<$4 AND hasta_m>$3 LIMIT 1",[id_pozo,id_intervalo,data.desde_m,data.hasta_m]);
    if(solapado.rows[0])throw new err.T05DatosIncorrectos("El intervalo de diámetro se solapa con otro intervalo.");

    const sql = `
      WITH bloqueo AS (SELECT pg_advisory_xact_lock($2::integer, 608))
      UPDATE intervalo_diametro_perforacion AS actual
      SET
        desde_m = $3,
        hasta_m = $4,
        diametro_pulg = $5,
        material_tuberia = $6,
        sin_tuberia = $7
      FROM bloqueo,pozo p
      WHERE actual.id_intervalo_diametro_perforacion = $1 AND actual.id_pozo = $2 AND p.id_pozo=$2
        AND (p.profundidad_final_m IS NULL OR $4<=p.profundidad_final_m)
        AND NOT EXISTS (SELECT 1 FROM intervalo_diametro_perforacion otro WHERE otro.id_pozo=$2 AND otro.id_intervalo_diametro_perforacion<>$1 AND otro.desde_m<$4 AND otro.hasta_m>$3)
      RETURNING actual.id_intervalo_diametro_perforacion,actual.id_pozo,actual.desde_m,actual.hasta_m,actual.diametro_pulg,actual.material_tuberia,actual.sin_tuberia;
    `;
    try {
      const { rows } = await dbEscritura.query(sql, [
        id_intervalo,
        id_pozo,
        data.desde_m,
        data.hasta_m,
        data.diametro_pulg,
        data.material_tuberia,
        data.sin_tuberia === true,
      ]);
      if(rows[0])return rows[0] as IntervaloDiametroPerforacion;
      const vigente=await dbEscritura.query("SELECT id_intervalo_diametro_perforacion FROM intervalo_diametro_perforacion WHERE id_intervalo_diametro_perforacion=$1 AND id_pozo=$2",[id_intervalo,id_pozo]);
      if(!vigente.rows[0])return null;
      throw new err.T05DatosIncorrectos("El intervalo de diámetro se solapa o excede la profundidad final.");
    } catch (e: unknown) {
      if (codigoPg(e) === "23514") {
        throw new err.T05DatosIncorrectos("Validación: 'hasta_m' debe ser mayor que 'desde_m'.");
      }
      throw e;
    }
  }, db, false);
}

function validarDatoDiametro(data:IntervaloDiametroPerforacionBody):void{
  if(!Number.isFinite(data.desde_m)||!Number.isFinite(data.hasta_m)||data.desde_m<0||data.hasta_m<=data.desde_m)throw new err.T05DatosIncorrectos("El intervalo de diámetro tiene un rango inválido.");
  if(!Number.isFinite(data.diametro_pulg)||data.diametro_pulg<=0)throw new err.T05DatosIncorrectos("El diámetro debe ser positivo.");
  const error = errorMaterialDiametro(data);
  if(error)throw new err.T05DatosIncorrectos(error);
}

function codigoPg(error: unknown): string | undefined { return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined; }

export async function deleteIntervaloDiametro(
  id_pozo: number,
  id_intervalo: number
): Promise<boolean> {
  return conEscrituraSesion(async (dbEscritura) => {
    const { rowCount } = await dbEscritura.query(
      `
      DELETE FROM intervalo_diametro_perforacion
      WHERE id_intervalo_diametro_perforacion = $1
        AND id_pozo = $2
      `,
      [id_intervalo, id_pozo]
    );
    return (rowCount ?? 0) > 0;
  }, myPool, false);
}

export async function getIntervaloDiametroById(
  id_pozo: number,
  id_intervalo: number
): Promise<IntervaloDiametroPerforacion | null> {
  const { rows } = await myPool.query(
    `
    SELECT id_intervalo_diametro_perforacion,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia,sin_tuberia
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
      ,material_tuberia                    AS material_tuberia
      ,sin_tuberia                         AS sin_tuberia
    FROM intervalo_diametro_perforacion
    WHERE id_pozo = $1
    ORDER BY desde_m
    `,
    [id_pozo]
  );
  return rows as IntervaloDiametroPerforacion[];
}
