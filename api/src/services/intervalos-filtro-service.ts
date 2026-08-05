import { myPool } from "../db/pool.ts";
import type { IntervaloFiltro, IntervaloFiltroBody } from "../models/schemas.ts";
import * as err from "../models/errors.ts";

export async function listarFiltros(idPozo: number): Promise<IntervaloFiltro[]> {
  const { rows } = await myPool.query("SELECT id_intervalo_filtro,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia FROM intervalo_filtro WHERE id_pozo=$1 ORDER BY desde_m,hasta_m", [idPozo]);
  return rows.map(normalizar);
}
export async function crearFiltro(idPozo: number, dato: IntervaloFiltroBody): Promise<IntervaloFiltro> {
  const { rows } = await myPool.query(`WITH bloqueo AS (SELECT pg_advisory_xact_lock($1::integer,607)) INSERT INTO intervalo_filtro (id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia) SELECT $1,$2,$3,$4,$5 FROM bloqueo JOIN pozo p ON p.id_pozo=$1 WHERE (p.profundidad_final_m IS NULL OR $3<=p.profundidad_final_m) AND NOT EXISTS (SELECT 1 FROM intervalo_filtro f WHERE f.id_pozo=$1 AND f.desde_m<$3 AND f.hasta_m>$2) RETURNING id_intervalo_filtro,id_pozo,desde_m,hasta_m,diametro_pulg,material_tuberia`, [idPozo,dato.desde_m,dato.hasta_m,dato.diametro_pulg,dato.material_tuberia]);
  if (!rows[0]) throw new err.T05DatosIncorrectos("El filtro se solapa o excede la profundidad final.");
  return normalizar(rows[0]);
}
export async function actualizarFiltro(idPozo: number, idFiltro: number, dato: IntervaloFiltroBody): Promise<IntervaloFiltro | null> {
  const { rows } = await myPool.query(`WITH bloqueo AS (SELECT pg_advisory_xact_lock($1::integer,607)) UPDATE intervalo_filtro f SET desde_m=$3,hasta_m=$4,diametro_pulg=$5,material_tuberia=$6 FROM bloqueo,pozo p WHERE f.id_pozo=$1 AND f.id_intervalo_filtro=$2 AND p.id_pozo=$1 AND (p.profundidad_final_m IS NULL OR $4<=p.profundidad_final_m) AND NOT EXISTS (SELECT 1 FROM intervalo_filtro o WHERE o.id_pozo=$1 AND o.id_intervalo_filtro<>$2 AND o.desde_m<$4 AND o.hasta_m>$3) RETURNING f.id_intervalo_filtro,f.id_pozo,f.desde_m,f.hasta_m,f.diametro_pulg,f.material_tuberia`, [idPozo,idFiltro,dato.desde_m,dato.hasta_m,dato.diametro_pulg,dato.material_tuberia]);
  return rows[0] ? normalizar(rows[0]) : null;
}
export async function eliminarFiltro(idPozo: number, idFiltro: number): Promise<boolean> {
  const resultado = await myPool.query("DELETE FROM intervalo_filtro WHERE id_pozo=$1 AND id_intervalo_filtro=$2", [idPozo,idFiltro]);
  return (resultado.rowCount ?? 0) > 0;
}
function normalizar(f: Record<string, unknown>): IntervaloFiltro { return { id_intervalo_filtro:Number(f.id_intervalo_filtro),id_pozo:Number(f.id_pozo),desde_m:Number(f.desde_m),hasta_m:Number(f.hasta_m),diametro_pulg:Number(f.diametro_pulg),material_tuberia:String(f.material_tuberia) as "PVC"|"Acero" }; }
