import type { Pool, PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import type { CandidatoPozo } from "../models/schemas.ts";
import * as err from "../models/errors.ts";

type Consultable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export async function listarCandidatosPozo(
  idSesion: number,
  esAdmin: boolean,
  db: Consultable = myPool,
  filtros: { propietario?: string; perforador?: string; limite?: number; propietarioId?: number; perforadorId?: number } = {},
): Promise<{ propietarios: CandidatoPozo[]; perforadores: CandidatoPozo[] }> {
  const limite = Math.min(Math.max(filtros.limite ?? 20, 1), 50);
  const propietarios = await candidatosPorRol("propietario", db, undefined, filtros.propietario, limite, filtros.propietarioId);
  const perforadores = esAdmin
    ? await candidatosPorRol("perforador", db, undefined, filtros.perforador, limite, filtros.perforadorId)
    : (await candidatosPorRol("perforador", db, idSesion, filtros.perforador, limite, filtros.perforadorId));
  return { propietarios, perforadores };
}

export async function validarPersonaPozo(
  idUsuario: number,
  rol: "propietario" | "perforador",
  db: Consultable,
): Promise<void> {
  const { rows } = await db.query(
    `SELECT u.id_usuario
     FROM usuario u
     JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
     JOIN rol r ON r.id_rol = ur.id_rol
     WHERE u.id_usuario = $1 AND u.activo = true AND r.nombre = $2
     LIMIT 1 FOR KEY SHARE OF u`,
    [idUsuario, rol],
  );
  if (!rows[0]) throw new err.T05DatosIncorrectos(`La persona seleccionada no está activa o no tiene rol ${rol}.`);
}

async function candidatosPorRol(rol: string, db: Consultable, idUsuario?: number, busqueda?: string, limite = 20, idExacto?: number): Promise<CandidatoPozo[]> {
  const { rows } = await db.query(
    `SELECT u.id_usuario, u.nombre, u.email, ARRAY[$1::text] AS roles
     FROM usuario u
     JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
     JOIN rol r ON r.id_rol = ur.id_rol
     WHERE u.activo = true AND r.nombre = $1
       AND ($2::integer IS NULL OR u.id_usuario = $2)
       AND ($3::integer IS NULL OR u.id_usuario = $3)
       AND ($4::text IS NULL OR lower(u.nombre) LIKE '%' || lower($4) || '%' OR lower(u.email) LIKE '%' || lower($4) || '%')
      ORDER BY lower(u.nombre), lower(u.email), u.id_usuario
      LIMIT $5`,
    [rol, idUsuario ?? null, idExacto ?? null, busqueda?.trim() || null, limite],
  );
  return rows.map((row) => ({
    id_usuario: Number(row.id_usuario), nombre: String(row.nombre), email: String(row.email),
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [rol],
  }));
}
