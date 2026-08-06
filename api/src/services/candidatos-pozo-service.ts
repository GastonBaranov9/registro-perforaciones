import type { Pool, PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import type { CandidatoPozo } from "../models/schemas.ts";
import * as err from "../models/errors.ts";

type Consultable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export async function listarCandidatosPozo(
  idSesion: number,
  esAdmin: boolean,
  db: Consultable = myPool,
): Promise<{ propietarios: CandidatoPozo[]; perforadores: CandidatoPozo[] }> {
  const propietarios = await candidatosPorRol("propietario", db);
  const perforadores = esAdmin
    ? await candidatosPorRol("perforador", db)
    : (await candidatosPorRol("perforador", db, idSesion));
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

async function candidatosPorRol(rol: string, db: Consultable, idUsuario?: number): Promise<CandidatoPozo[]> {
  const { rows } = await db.query(
    `SELECT u.id_usuario, u.nombre, u.email, ARRAY[$1::text] AS roles
     FROM usuario u
     JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
     JOIN rol r ON r.id_rol = ur.id_rol
     WHERE u.activo = true AND r.nombre = $1
       AND ($2::integer IS NULL OR u.id_usuario = $2)
     ORDER BY lower(u.nombre), lower(u.email), u.id_usuario`,
    [rol, idUsuario ?? null],
  );
  return rows.map((row) => ({
    id_usuario: Number(row.id_usuario), nombre: String(row.nombre), email: String(row.email),
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [rol],
  }));
}
