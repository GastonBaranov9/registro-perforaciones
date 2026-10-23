import type { PoolClient } from 'pg';
import { myPool } from '../db/pool.ts';
import { T05DatosIncorrectos, T05SinPermiso } from '../models/errors.ts';

export const ROLES_CAPACIDAD = {
  operarTodosLosPozos: ['administracion'],
  alcancePerforador: ['perforador', 'operador_administrativo'],
  gestionarHistoricos: ['administracion', 'operador_administrativo'],
  escribirPozos: ['administracion', 'operador_administrativo', 'perforador'],
  consultarRecursos: ['administracion', 'operador_administrativo', 'perforador', 'propietario'],
  administrarUsuarios: ['administracion'],
} as const;
export type Capacidad = keyof typeof ROLES_CAPACIDAD;
type Db = Pick<PoolClient, 'query'>;

export function rolesPermiten(roles: readonly string[], capacidad: Capacidad): boolean {
  return roles.some(rol => (ROLES_CAPACIDAD[capacidad] as readonly string[]).includes(normalizarNombreRol(rol)));
}

// Igual que LOWER(nombre) en rolUser: sólo mayúsculas/minúsculas, sin quitar
// espacios, acentos ni transformar nombres desconocidos en roles canónicos.
const normalizarNombreRol = (nombre: string): string => nombre.toLowerCase();

// Siempre consultar roles persistidos del actor; nunca roles del JWT o de la URL.
export async function tieneCapacidad(actor: number, capacidad: Capacidad, db: Db = myPool): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT r.nombre FROM rol r JOIN usuario_rol ur ON ur.id_rol=r.id_rol
     JOIN usuario u ON u.id_usuario=ur.id_usuario
     WHERE ur.id_usuario=$1 AND u.activo AND u.cuenta_acceso`, [actor]);
  return rolesPermiten(rows.map(r => r.nombre), capacidad);
}

export async function exigirCapacidad(actor: number, capacidad: Capacidad, db: Db = myPool): Promise<void> {
  if (!await tieneCapacidad(actor, capacidad, db)) throw new T05SinPermiso();
}

export const puedeOperarTodosLosPozos = (actor: number, db: Db = myPool) => tieneCapacidad(actor, 'operarTodosLosPozos', db);

export function validarCompatibilidadRoles(nombres: readonly string[]): void {
  const normalizados = nombres.map(normalizarNombreRol);
  if (normalizados.includes('administracion') && normalizados.includes('operador_administrativo'))
    throw new T05DatosIncorrectos('Administración y operador administrativo no pueden asignarse a la misma cuenta.');
}

// Los llamadores mantienen el lock administrativo exclusivo durante la validación y escritura.
export async function validarIdsRolesCompatibles(ids: readonly number[], db: Db): Promise<void> {
  const { rows } = await db.query('SELECT nombre FROM rol WHERE id_rol = ANY($1::int[])', [ids]);
  validarCompatibilidadRoles(rows.map(r => r.nombre));
}
