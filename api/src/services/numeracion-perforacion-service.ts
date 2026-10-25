import { iniciarEscrituraSesion } from "./escritura-sesion.ts";
import type { Pool, PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import * as err from "../models/errors.ts";
import { emitirConfirmacion, verificarConfirmacion, exigirMotivo } from './confirmacion-numeracion.ts';

export const MAX_NUMERO_PERFORACION = 2147483647;
type Db = Pick<PoolClient, "query">;
type ConnectionPool = Pick<Pool, "connect">;
export interface EstadoNumeracion { proximo: number | null; minimo: number; agotado: boolean; puede_retroceder?: boolean }

export function validarNumeroPerforacion(numero: unknown): asserts numero is number {
  if (typeof numero !== "number" || !Number.isInteger(numero) || numero < 1 || numero > MAX_NUMERO_PERFORACION)
    throw new err.T05DatosIncorrectos("El número de perforación debe ser un entero entre 1 y 2147483647.");
}

export async function exigirAdministracionNumeracion(idUsuario: number, db: Db = myPool): Promise<void> {
  const { rows } = await db.query(
    "SELECT u.id_usuario FROM public.usuario u JOIN public.usuario_rol ur ON ur.id_usuario=u.id_usuario JOIN public.rol r ON r.id_rol=ur.id_rol WHERE u.id_usuario=$1 AND u.activo AND u.cuenta_acceso AND r.nombre='administracion'",
    [idUsuario],
  );
  if (!rows.length) throw new err.T05SinPermiso("Solo administración puede asignar números manuales o configurar la numeración.");
}

export function traducirErrorNumeracion(error: unknown): unknown {
  const pg = error as { code?: string; constraint?: string };
  if (pg?.code === "23505" && ["pozo_numero_perforacion_uq", "numero_perforacion_reservado_pkey"].includes(pg.constraint ?? ""))
    return new err.T05ConflictoNumeracion("Ese número de perforación ya está utilizado o reservado.");
  if (pg?.code === "P1100") return new err.T05ConflictoNumeracion("Administración todavía debe habilitar la numeración empresarial. No se pueden guardar perforaciones nuevas hasta que lo haga.");
  if (pg?.code === "P1102") return new err.T05ConflictoNumeracion("El número de perforación ya asignado no se puede modificar.");
  if (pg?.code === "P1104") return new err.T05ConflictoNumeracion("El número configurado no está disponible. Revisá su situación.");
  if (pg?.code === "P1103") return new err.T05ConflictoNumeracion("Se agotó el rango de numeración de perforaciones.");
  return error;
}

function estado(fila: { proximo: string | number | null; mayor_asignado: number }): EstadoNumeracion {
  const proximo = fila.proximo == null ? null : Number(fila.proximo);
  // El rango 1..3281 es histórico, aunque todavía no tenga reservas cargadas.
  const minimo = 3282;
  return { proximo, minimo, agotado: proximo !== null && proximo > MAX_NUMERO_PERFORACION };
}

export async function obtenerNumeracion(idUsuario: number, db: Db = myPool): Promise<EstadoNumeracion> {
  await exigirAdministracionNumeracion(idUsuario, db);
  const { rows } = await db.query("SELECT proximo, mayor_asignado FROM public.numeracion_perforacion WHERE singleton=TRUE");
  return {...estado(rows[0]),puede_retroceder:!!await autorizacionNumeracion(idUsuario,db)};
}

async function autorizacionNumeracion(actor:number,db:Db,lock=false) {
  return (await db.query(`SELECT id::text,revision::text,concedida_en FROM autorizacion_numeracion WHERE usuario=$1 AND activa ${lock?'FOR SHARE':''}`,[actor])).rows[0]??null;
}
async function situacionConfiguracion(actor:number,numero:number,motivo:string,db:Db,lock=false) {
  validarNumeroPerforacion(numero); exigirMotivo(motivo);
  if(numero<3282)throw new err.T05DatosIncorrectos('Los números hasta 3281 se gestionan como históricos.');
  await exigirAdministracionNumeracion(actor,db);
  const c=(await db.query(`SELECT proximo,mayor_asignado FROM numeracion_perforacion WHERE singleton ${lock?'FOR UPDATE':''}`)).rows[0];
  const anterior=c.proximo==null?null:Number(c.proximo),autorizacion=await autorizacionNumeracion(actor,db,lock);
  const r=(await db.query(`SELECT EXISTS(SELECT 1 FROM pozo WHERE numero_perforacion=$1) activo,
    EXISTS(SELECT 1 FROM numero_perforacion_reservado WHERE numero_perforacion=$1) reservado,
    EXISTS(SELECT 1 FROM numeros_no_disponibles() WHERE numero=$1) incompatible,
    (SELECT COALESCE(max(id),0)::text FROM numeracion_perforacion_configuracion) revision`,[numero])).rows[0];
  const tipo=anterior===null?'habilitacion':numero<anterior?'retroceso':'adelanto';
  const bloqueos:string[]=[];
  if(numero===anterior)bloqueos.push('No realizaste ningún cambio.');
  if(r.activo)bloqueos.push('El número solicitado ya pertenece a una perforación.');
  else if(r.reservado)bloqueos.push('Este número está reservado. Revisá su situación antes de utilizarlo.');
  else if(r.incompatible)bloqueos.push('Existen referencias anteriores que impiden utilizar este número.');
  if((tipo==='retroceso'||numero<=c.mayor_asignado)&&!autorizacion)bloqueos.push('Para retroceder necesitás autorización especial de numeración.');
  return {anterior,nuevo:numero,tipo,mayor:c.mayor_asignado,revision:r.revision,autorizacion,
    disponible:!r.incompatible,motivo:motivo.trim(),bloqueos,
    salto_grande:anterior!==null&&Math.abs(numero-anterior)>=100};
}
export async function revisarConfiguracion(actor:number,numero:number,motivo:string,db:Db=myPool) {
  const s=await situacionConfiguracion(actor,numero,motivo,db);
  return {...s,token:s.bloqueos.length?null:emitirConfirmacion(actor,'configurar',numero,s)};
}
export interface ConfirmacionConfiguracion { token:string; confirmacion:string; registros_fisicos_confirmados:boolean }
export async function configurarNumeracion(idUsuario:number,proximo:number,esperado:number|null,motivo:string,pool:ConnectionPool=myPool,confirmacion?:ConfirmacionConfiguracion):Promise<EstadoNumeracion> {
  validarNumeroPerforacion(proximo);exigirMotivo(motivo);
  if(!confirmacion||confirmacion.confirmacion!==`CONFIRMAR ${proximo}`||confirmacion.registros_fisicos_confirmados!==true)
    throw new err.T05DatosIncorrectos('Revisá el cambio, confirmá los registros físicos y escribí la confirmación requerida.');
  const client=await pool.connect();
  try{
    await iniciarEscrituraSesion(client,true);
    const s=await situacionConfiguracion(idUsuario,proximo,motivo,client,true);
    if(s.anterior!==esperado)throw new err.T05ConflictoNumeracion('El contador cambió mientras estabas trabajando. Actualizá la información antes de continuar.');
    if(s.bloqueos.length)throw new err.T05ConflictoNumeracion(s.bloqueos.join(' '));
    const c=verificarConfirmacion(confirmacion.token,idUsuario,'configurar',proximo,s);
    if((await client.query('SELECT 1 FROM numeracion_perforacion_configuracion WHERE nonce=$1',[c.nonce])).rowCount)
      throw new err.T05ConflictoNumeracion('La confirmación ya fue utilizada.');
    await client.query('UPDATE numeracion_perforacion SET proximo=$1 WHERE singleton',[proximo]);
    await client.query(`INSERT INTO numeracion_perforacion_configuracion(anterior,proximo,cambiado_por,motivo,tipo,estado_verificado,autorizacion_id,nonce,confirmacion)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[s.anterior,proximo,idUsuario,s.motivo,s.tipo,JSON.stringify({...s,registros_fisicos_confirmados:true}),s.autorizacion?.id??null,c.nonce,confirmacion.confirmacion]);
    await client.query('COMMIT');
    return {proximo,minimo:3282,agotado:false,puede_retroceder:!!s.autorizacion};
  }catch(e){await client.query('ROLLBACK');throw traducirErrorNumeracion(e);}finally{client.release();}
}
export async function historialNumeracion(actor:number,antes?:string,db:Db=myPool) {
  await exigirAdministracionNumeracion(actor,db);
  if(antes!==undefined&&!/^[1-9][0-9]{0,18}$/.test(antes))throw new err.T05DatosIncorrectos('Página de historial inválida.');
  return (await db.query(`SELECT c.id::text,c.anterior,c.proximo,c.motivo,c.cambiado_en,
    COALESCE(c.tipo,'cambio auditado') tipo,
    c.cambiado_por::text responsable_id,COALESCE(u.nombre,'Cuenta anterior') responsable
    FROM numeracion_perforacion_configuracion c LEFT JOIN usuario u ON u.id_usuario=c.cambiado_por
    WHERE ($1::bigint IS NULL OR c.id<$1) ORDER BY c.id DESC LIMIT 30`,[antes??null])).rows;
}

export async function consultarNumero(idUsuario: number, numero: number, db: Db = myPool): Promise<{ utilizado: boolean }> {
  validarNumeroPerforacion(numero);
  await exigirAdministracionNumeracion(idUsuario, db);
  const { rows } = await db.query("SELECT 1 FROM public.numero_perforacion_reservado WHERE numero_perforacion=$1", [numero]);
  return { utilizado: rows.length > 0 };
}

export async function asignarNumeroPendiente(idUsuario: number, idPozo: number, numero: number, pool: ConnectionPool = myPool): Promise<{ numero_perforacion: number }> {
  validarNumeroPerforacion(numero);
  if (numero > 3281) throw new err.T05DatosIncorrectos('La asignación manual está limitada a históricos hasta 3281.');
  const client = await pool.connect();
  try {
    await iniciarEscrituraSesion(client, false);
    await exigirAdministracionNumeracion(idUsuario, client);
    const { rows } = await client.query("SELECT numero_perforacion FROM public.pozo WHERE id_pozo=$1 FOR UPDATE", [idPozo]);
    if (!rows[0]) throw new err.T05PozoNoEncontrado();
    if (rows[0].numero_perforacion != null) throw new err.T05ConflictoNumeracion("Este pozo ya tiene un número de perforación asignado.");
    await client.query("UPDATE public.pozo SET numero_perforacion=$2 WHERE id_pozo=$1", [idPozo, numero]);
    await client.query("COMMIT");
    return { numero_perforacion: numero };
  } catch (error) {
    await client.query("ROLLBACK");
    throw traducirErrorNumeracion(error);
  } finally { client.release(); }
}
