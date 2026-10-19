import { iniciarEscrituraSesion } from "./escritura-sesion.ts";
import type { Pool, PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import * as err from "../models/errors.ts";

export const MAX_NUMERO_PERFORACION = 2147483647;
type Db = Pick<PoolClient, "query">;
type ConnectionPool = Pick<Pool, "connect">;
export interface EstadoNumeracion { proximo: number | null; minimo: number; agotado: boolean }

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
  if (pg?.code === "P1103") return new err.T05ConflictoNumeracion("Se agotó el rango de numeración de perforaciones.");
  return error;
}

function estado(fila: { proximo: string | number | null; mayor_asignado: number }): EstadoNumeracion {
  const proximo = fila.proximo == null ? null : Number(fila.proximo);
  // El rango 1..3281 es histórico, aunque todavía no tenga reservas cargadas.
  const minimo = Math.max(3282, fila.mayor_asignado + 1, proximo ?? 3282);
  return { proximo, minimo, agotado: minimo > MAX_NUMERO_PERFORACION };
}

export async function obtenerNumeracion(idUsuario: number, db: Db = myPool): Promise<EstadoNumeracion> {
  await exigirAdministracionNumeracion(idUsuario, db);
  const { rows } = await db.query("SELECT proximo, mayor_asignado FROM public.numeracion_perforacion WHERE singleton=TRUE");
  return estado(rows[0]);
}

export async function configurarNumeracion(idUsuario: number, proximo: number, esperado: number | null, pool: ConnectionPool = myPool): Promise<EstadoNumeracion> {
  validarNumeroPerforacion(proximo);
  if (esperado !== null && (!Number.isInteger(esperado) || esperado < 1 || esperado > MAX_NUMERO_PERFORACION + 1))
    throw new err.T05DatosIncorrectos("El valor anterior del contador no es válido.");
  const client = await pool.connect();
  try {
    await iniciarEscrituraSesion(client, false);
    await exigirAdministracionNumeracion(idUsuario, client);
    const { rows } = await client.query("SELECT proximo, mayor_asignado FROM public.numeracion_perforacion WHERE singleton=TRUE FOR UPDATE");
    const actual = estado(rows[0]);
    if (actual.proximo !== esperado) throw new err.T05ConflictoNumeracion("El contador cambió. Actualice la información antes de configurarlo.");
    if (proximo < actual.minimo) throw new err.T05ConflictoNumeracion("El próximo número debe ser al menos " + actual.minimo + ". El contador no puede retroceder.");
    await client.query("UPDATE public.numeracion_perforacion SET proximo=$1 WHERE singleton=TRUE", [proximo]);
    await client.query("INSERT INTO public.numeracion_perforacion_configuracion(anterior,proximo,cambiado_por) VALUES ($1,$2,$3)", [actual.proximo, proximo, idUsuario]);
    await client.query("COMMIT");
    return { proximo, minimo: proximo, agotado: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw traducirErrorNumeracion(error);
  } finally { client.release(); }
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
