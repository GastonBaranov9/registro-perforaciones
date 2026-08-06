import { myPool } from "../db/pool.ts";
import * as err from "../models/errors.ts";
import type { bodyIntervaloLitologico } from "../models/schemas.ts";

type DatoLitologico = typeof bodyIntervaloLitologico.static;

export async function createIntervaloLitologico(idPozo:number,data:DatoLitologico){
  await validarRangoContraPozo(idPozo,data);
  let fila:Record<string,unknown>|undefined;
  try{
    const {rows}=await myPool.query(`WITH bloqueo AS (SELECT pg_advisory_xact_lock($1::integer,606))
      INSERT INTO intervalo_litologico (id_pozo,desde_m,hasta_m,material,id_litologia)
      SELECT $1,$2,$3,COALESCE(c.nombre,$4),c.id_litologia FROM bloqueo JOIN pozo p ON p.id_pozo=$1
      LEFT JOIN catalogo_litologia c ON c.activo AND (($5::bigint IS NOT NULL AND c.id_litologia=$5) OR ($5::bigint IS NULL AND c.nombre_normalizado=litologia_normalizar($4)))
      WHERE (p.profundidad_final_m IS NULL OR $3<=p.profundidad_final_m)
      AND ($5::bigint IS NULL OR c.id_litologia IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM intervalo_litologico i WHERE i.id_pozo=$1 AND i.desde_m<$3 AND i.hasta_m>$2)
      RETURNING id_intervalo_litologico,id_pozo,desde_m,hasta_m,material,id_litologia`,[idPozo,data.desde_m,data.hasta_m,data.material,data.id_litologia??null]);
    fila=rows[0];
  }catch(error:unknown){throw traducirErrorPostgres(error);}
  if(!fila)throw new err.T05DatosIncorrectos("El intervalo se solapa o excede la profundidad final.");
  return fila;
}

export async function updateIntervaloLitologico(idPozo:number,idIntervalo:number,data:DatoLitologico){
  await validarRangoContraPozo(idPozo,data);
  let fila:Record<string,unknown>|undefined;
  try{
    const {rows}=await myPool.query(`WITH bloqueo AS (SELECT pg_advisory_xact_lock($2::integer,606)), elegida AS (SELECT id_litologia,nombre FROM catalogo_litologia WHERE activo AND (($6::bigint IS NOT NULL AND id_litologia=$6) OR ($6::bigint IS NULL AND nombre_normalizado=litologia_normalizar($5))))
      UPDATE intervalo_litologico actual SET desde_m=$3,hasta_m=$4,material=COALESCE(e.nombre,$5),id_litologia=CASE WHEN e.id_litologia IS NOT NULL THEN e.id_litologia WHEN $6::bigint IS NULL AND litologia_normalizar(actual.material)=litologia_normalizar($5) THEN actual.id_litologia ELSE NULL END FROM bloqueo CROSS JOIN pozo p LEFT JOIN elegida e ON TRUE
      WHERE actual.id_intervalo_litologico=$1 AND actual.id_pozo=$2 AND p.id_pozo=$2
      AND ($6::bigint IS NULL OR e.id_litologia IS NOT NULL)
      AND (p.profundidad_final_m IS NULL OR $4<=p.profundidad_final_m)
      AND NOT EXISTS (SELECT 1 FROM intervalo_litologico otro WHERE otro.id_pozo=$2 AND otro.id_intervalo_litologico<>$1 AND otro.desde_m<$4 AND otro.hasta_m>$3)
      RETURNING actual.id_intervalo_litologico,actual.id_pozo,actual.desde_m,actual.hasta_m,actual.material,actual.id_litologia`,[idIntervalo,idPozo,data.desde_m,data.hasta_m,data.material,data.id_litologia??null]);
    fila=rows[0];
  }catch(error:unknown){throw traducirErrorPostgres(error);}
  if(!fila){
    const existe=await myPool.query("SELECT id_intervalo_litologico FROM intervalo_litologico WHERE id_intervalo_litologico=$1 AND id_pozo=$2",[idIntervalo,idPozo]);
    if(!existe.rows[0])return null;
    throw new err.T05DatosIncorrectos("El intervalo se solapa o excede la profundidad final.");
  }
  return fila;
}

export async function deleteIntervaloLitologico(idPozo:number,idIntervalo:number){const {rowCount}=await myPool.query("DELETE FROM intervalo_litologico WHERE id_intervalo_litologico=$1 AND id_pozo=$2",[idIntervalo,idPozo]);return(rowCount??0)>0;}
export async function getIntervaloLitologicoById(idPozo:number,idIntervalo:number){const {rows}=await myPool.query("SELECT i.id_intervalo_litologico,i.id_pozo,i.desde_m,i.hasta_m,i.material,i.id_litologia,c.nombre AS litologia_nombre,c.color AS litologia_color,c.patron AS litologia_patron,c.activo AS litologia_activa FROM intervalo_litologico i LEFT JOIN catalogo_litologia c ON c.id_litologia=i.id_litologia WHERE i.id_intervalo_litologico=$1 AND i.id_pozo=$2",[idIntervalo,idPozo]);return rows[0]??null;}
export async function listIntervalosLitologicosByPozo(idPozo:number){const {rows}=await myPool.query("SELECT i.id_intervalo_litologico,i.id_pozo,i.desde_m,i.hasta_m,i.material,i.id_litologia,c.nombre AS litologia_nombre,c.color AS litologia_color,c.patron AS litologia_patron,c.activo AS litologia_activa FROM intervalo_litologico i LEFT JOIN catalogo_litologia c ON c.id_litologia=i.id_litologia WHERE i.id_pozo=$1 ORDER BY i.desde_m",[idPozo]);return rows;}

async function validarRangoContraPozo(idPozo:number,dato:DatoLitologico){
  if(!Number.isFinite(dato.desde_m)||dato.desde_m<0||!Number.isFinite(dato.hasta_m)||dato.hasta_m<=dato.desde_m)throw new err.T05DatosIncorrectos("El intervalo litológico tiene un rango inválido.");
  const {rows}=await myPool.query("SELECT profundidad_final_m FROM pozo WHERE id_pozo=$1",[idPozo]);
  if(!rows[0])throw new err.T05PozoNoEncontrado();
  const profundidad=rows[0].profundidad_final_m==null?null:Number(rows[0].profundidad_final_m);
  if(profundidad!==null&&dato.hasta_m>profundidad)throw new err.T05DatosIncorrectos("El intervalo litológico excede la profundidad final.");
}

export function traducirErrorPostgres(error:unknown):unknown{
  const codigo=typeof error==="object"&&error!==null&&"code" in error?String(error.code):undefined;
  if(codigo==="23514")return new err.T05DatosIncorrectos("Validación fallida.");
  if(codigo==="23503")return new err.T05PozoNoEncontrado("El pozo indicado no existe.");
  if(codigo?.startsWith("23"))return new err.T05DatosIncorrectos("Error de integridad de datos.");
  return error;
}
