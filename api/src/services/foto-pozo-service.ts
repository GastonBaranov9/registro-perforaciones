import { myPool } from "../db/pool.ts";
import * as err from "../models/errors.ts";
import type { Pool, PoolClient } from "pg";
import { aislarFotosExistentes, purgarFotosConfirmadas, reemplazarFotoReversible, restaurarFotosAisladas, type FotoAislada, type LoggerPurga } from "./foto-archivo-service.ts";

export async function eliminarFotoPersistida(
  idPozo: number,
  directorio: string,
  pool: Pick<Pool,"connect"> = myPool,
  opciones: { logger?: LoggerPurga; eliminarPostCommit?: (ruta: string) => Promise<void> } = {},
): Promise<{ archivoExistia: boolean }> {
  const client=await pool.connect();let fotosAisladas:FotoAislada[]=[];let confirmada=false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::integer,606)",[idPozo]);
    const vigente=await client.query("SELECT id_pozo,foto_url FROM pozo WHERE id_pozo=$1 FOR UPDATE",[idPozo]);
    if(!vigente.rows[0])throw new err.T05PozoNoEncontrado();
    fotosAisladas=await aislarFotosExistentes(idPozo,directorio);
    await client.query(
      `UPDATE public.pozo SET foto_url = NULL WHERE id_pozo = $1
       RETURNING id_pozo`,
      [idPozo],
    );
    await client.query("COMMIT");confirmada=true;
  } catch (error) {
    if(!confirmada)await client.query("ROLLBACK");
    await restaurarFotosAisladas(fotosAisladas);
    throw error;
  }finally{client.release();}
  await purgarFotosConfirmadas(fotosAisladas,idPozo,"eliminar_foto",opciones.logger,opciones.eliminarPostCommit);
  return { archivoExistia: fotosAisladas.length > 0 };
}

export async function eliminarPozoPersistido(
  idPozo:number,
  directorio:string,
  pool:Pick<Pool,"connect">=myPool,
  opciones:{logger?:LoggerPurga;eliminarPostCommit?:(ruta:string)=>Promise<void>}={},
):Promise<{fotos:number}>{
  const client=await pool.connect();let fotosAisladas:FotoAislada[]=[];let confirmada=false;
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::integer,606)",[idPozo]);
    const vigente=await client.query("SELECT id_pozo FROM pozo WHERE id_pozo=$1 FOR UPDATE",[idPozo]);
    if(!vigente.rows[0])throw new err.T05PozoNoEncontrado();
    fotosAisladas=await aislarFotosExistentes(idPozo,directorio);
    const borrado=await client.query("DELETE FROM public.pozo WHERE id_pozo=$1 RETURNING id_pozo",[idPozo]);
    if(!borrado.rows[0])throw new err.T05PozoNoEncontrado();
    await client.query("COMMIT");confirmada=true;
  }catch(error){
    if(!confirmada)await client.query("ROLLBACK");
    try{await restaurarFotosAisladas(fotosAisladas);}catch(restauracion){throw new err.T05ErrorDesconocido("Falló el borrado y no se pudieron restaurar sus fotografías.",{cause:restauracion});}
    throw error;
  }finally{client.release();}
  await purgarFotosConfirmadas(fotosAisladas,idPozo,"eliminar_pozo",opciones.logger,opciones.eliminarPostCommit);
  return{fotos:fotosAisladas.length};
}

export async function reemplazarFotoPersistida<T>(idPozo:number,directorio:string,foto:{buffer:Buffer;extension:"jpg"|"png"},fotoUrl:string,actualizar:(client:PoolClient,url:string)=>Promise<T>,pool:Pick<Pool,"connect">=myPool,opciones:{logger?:LoggerPurga;eliminarPostCommit?:(ruta:string)=>Promise<void>}={}):Promise<T>{
  const client=await pool.connect();let confirmada=false;
  try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock($1::integer,606)",[idPozo]);const vigente=await client.query("SELECT id_pozo,foto_url FROM pozo WHERE id_pozo=$1 FOR UPDATE",[idPozo]);if(!vigente.rows[0])throw new err.T05PozoNoEncontrado();
    const operacion=await reemplazarFotoReversible(idPozo,directorio,foto,async(url)=>{const resultado=await actualizar(client,url);await client.query("COMMIT");confirmada=true;return resultado;},fotoUrl);
    await purgarFotosConfirmadas(operacion.anteriores,idPozo,"reemplazar_foto_multipart",opciones.logger,opciones.eliminarPostCommit);return operacion.resultado;
  }catch(error){if(!confirmada)await client.query("ROLLBACK");throw error;}finally{client.release();}
}
