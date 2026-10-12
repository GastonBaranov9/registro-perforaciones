import type { Pool, PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import { T05SinPermiso, T05PozoNoEncontrado } from "../models/errors.ts";
import { rolUser } from './auth-services.ts';
import { puedeOperarTodosLosPozos } from './capacidades.ts';

export const MENSAJE_EDICION_POZO = "El perforador solo puede editar perforaciones propias dentro de las primeras 24 horas desde su creación.";
export const VENTANA_EDICION_MS = 24 * 60 * 60 * 1000;
type Db = Pick<Pool | PoolClient, "query">;
type Creacion = { creado_por: number | string | null; fecha_creado: Date | string | null; origen?:string };

// Administración conserva sitios independientes; el alcance operativo global
// sólo habilita sitios asociados. En escritura se retiene una asociación hasta COMMIT.
export async function puedeOperarSitioGlobal(idSitio: number, actor: number, db: Db = myPool, bloquear = false): Promise<boolean> {
  if (await rolUser(actor, 'administracion', db)) return true;
  if (!await puedeOperarTodosLosPozos(actor, db)) return false;
  const { rows } = await db.query(
    'SELECT id_pozo FROM public.pozo WHERE id_sitio=$1 LIMIT 1' + (bloquear ? ' FOR SHARE' : ''), [idSitio]);
  if (!rows.length) throw new T05SinPermiso('El operador sólo puede acceder a sitios asociados a una perforación.');
  return true;
}

// El reloj se inyecta en pruebas; producción usa siempre el reloj del servidor.
export function puedeEditarCreacion(pozo: Creacion, idUsuario: number, ahora = Date.now()): boolean {
  const creado = pozo.fecha_creado == null ? NaN : new Date(pozo.fecha_creado).getTime();
  return Number(pozo.creado_por) === idUsuario && Number.isFinite(creado)
    && ahora >= creado && ahora < creado + VENTANA_EDICION_MS;
}

export async function exigirEdicionPozo(idPozo: number, idUsuario: number, db: Db = myPool, ahora = Date.now()): Promise<void> {
  const { rows } = await db.query<Creacion>("SELECT creado_por, fecha_creado, origen FROM public.pozo WHERE id_pozo = $1", [idPozo]);
  if (!rows[0]) throw new T05PozoNoEncontrado();
  if (rows[0].origen==='historico' || !puedeEditarCreacion(rows[0], idUsuario, ahora)) throw new T05SinPermiso(MENSAJE_EDICION_POZO);
}

export async function exigirEdicionSitio(idSitio: number, idUsuario: number, db: Db = myPool, ahora = Date.now()): Promise<void> {
  const { rows } = await db.query<Creacion>("SELECT creado_por, fecha_creado, origen FROM public.pozo WHERE id_sitio = $1", [idSitio]);
  // Una ubicación compartida no puede servir de vía indirecta para editar otro pozo.
  if (!rows.length || !rows.every(pozo => pozo.origen!=='historico' && puedeEditarCreacion(pozo, idUsuario, ahora)))
    throw new T05SinPermiso(MENSAJE_EDICION_POZO);
}
