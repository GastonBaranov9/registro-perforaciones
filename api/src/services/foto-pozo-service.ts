import { myPool } from "../db/pool.ts";
import * as err from "../models/errors.ts";
import type { Pool, PoolClient } from "pg";
import { aislarFotoExistente, purgarFotoConfirmada, reemplazarFotoReversible, restaurarFotoAislada, type LoggerPurga } from "./foto-archivo-service.ts";

export async function eliminarFotoPersistida(
  idPozo: number,
  directorio: string,
  pool: Pick<Pool,"connect"> = myPool,
  opciones: { logger?: LoggerPurga; eliminarPostCommit?: (ruta: string) => Promise<void> } = {},
): Promise<{ archivoExistia: boolean }> {
  const client=await pool.connect();let fotoAislada=null;let confirmada=false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::integer,606)",[idPozo]);
    const vigente=await client.query("SELECT id_pozo,foto_url FROM pozo WHERE id_pozo=$1 FOR UPDATE",[idPozo]);
    if(!vigente.rows[0])throw new err.T05PozoNoEncontrado();
    if(vigente.rows[0].foto_url)fotoAislada=await aislarFotoExistente(idPozo,directorio);
    await client.query(
      `UPDATE public.pozo SET foto_url = NULL WHERE id_pozo = $1
       RETURNING id_pozo`,
      [idPozo],
    );
    await client.query("COMMIT");confirmada=true;
  } catch (error) {
    if(!confirmada)await client.query("ROLLBACK");
    await restaurarFotoAislada(fotoAislada);
    throw error;
  }finally{client.release();}
  await purgarFotoConfirmada(fotoAislada,idPozo,"eliminar_foto",opciones.logger,opciones.eliminarPostCommit);
  return { archivoExistia: Boolean(fotoAislada) };
}

export async function reemplazarFotoPersistida<T>(idPozo:number,directorio:string,foto:{buffer:Buffer;extension:"jpg"|"png"},fotoUrl:string,actualizar:(client:PoolClient,url:string)=>Promise<T>,pool:Pick<Pool,"connect">=myPool,opciones:{logger?:LoggerPurga;eliminarPostCommit?:(ruta:string)=>Promise<void>}={}):Promise<T>{
  const client=await pool.connect();let confirmada=false;
  try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock($1::integer,606)",[idPozo]);const vigente=await client.query("SELECT id_pozo,foto_url FROM pozo WHERE id_pozo=$1 FOR UPDATE",[idPozo]);if(!vigente.rows[0])throw new err.T05PozoNoEncontrado();
    const operacion=await reemplazarFotoReversible(idPozo,directorio,foto,async(url)=>{const resultado=await actualizar(client,url);await client.query("COMMIT");confirmada=true;return resultado;},fotoUrl);
    await purgarFotoConfirmada(operacion.anterior,idPozo,"reemplazar_foto_multipart",opciones.logger,opciones.eliminarPostCommit);return operacion.resultado;
  }catch(error){if(!confirmada)await client.query("ROLLBACK");throw error;}finally{client.release();}
}
