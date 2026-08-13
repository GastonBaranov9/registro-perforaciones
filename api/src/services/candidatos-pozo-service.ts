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
  const propietario = filtros.propietario?.trim() || undefined;
  const perforador = filtros.perforador?.trim() || undefined;
  const propietarios = propietario || filtros.propietarioId
    ? await candidatosPorRol("propietario", db, undefined, propietario, limite, filtros.propietarioId)
    : [];
  const perforadores = esAdmin
    ? (perforador || filtros.perforadorId
      ? await candidatosPorRol("perforador", db, undefined, perforador, limite, filtros.perforadorId)
      : [])
    : (await candidatosPorRol("perforador", db, idSesion, perforador, limite, filtros.perforadorId));
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

export async function crearPropietarioOperativo(
  data: { nombre: string },
  db: Pick<Pool, "connect"> = myPool,
): Promise<CandidatoPozo> {
  const nombre = data.nombre.trim();
  if (!nombre) throw new err.T05DatosIncorrectos("El nombre del propietario es obligatorio.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows: roles } = await client.query<{ id_rol: number }>(
      "SELECT id_rol FROM rol WHERE nombre=$1 FOR SHARE",
      ["propietario"],
    );
    if (!roles[0]) throw new err.T05RolNoEncontrado();
    const { rows } = await client.query<{ id_usuario: number; nombre: string; email: string }>(
      `INSERT INTO usuario (email,nombre,password,activo,cuenta_acceso)
       VALUES (NULL,$1,NULL,TRUE,FALSE)
       RETURNING id_usuario,nombre,email`,
      [nombre],
    );
    await client.query(
      "INSERT INTO usuario_rol (id_usuario,id_rol) VALUES ($1,$2)",
      [rows[0].id_usuario, roles[0].id_rol],
    );
    await client.query("COMMIT");
    return { id_usuario: Number(rows[0].id_usuario), nombre: rows[0].nombre, email: undefined, roles: ["propietario"] };
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
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
    id_usuario: Number(row.id_usuario), nombre: String(row.nombre),
    ...(row.email == null ? {} : { email: String(row.email) }),
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [rol],
  }));
}
