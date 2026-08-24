import type { Pool, PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import type { CandidatoPozo, PropietarioOperativo, PropietarioOperativoActualizarBody, PropietarioOperativoCrearBody } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { esDepartamentoUruguay } from "../constants/departamentos-uruguay.ts";

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
  data: PropietarioOperativoCrearBody,
  db: Pick<Pool, "connect"> = myPool,
): Promise<CandidatoPozo> {
  const normalizado = normalizarPropietario(data, true);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows: roles } = await client.query<{ id_rol: number }>(
      "SELECT id_rol FROM rol WHERE nombre=$1 FOR SHARE",
      ["propietario"],
    );
    if (!roles[0]) throw new err.T05RolNoEncontrado();
    const { rows } = await client.query<Record<string, unknown>>(
      `INSERT INTO usuario (
         email,nombre,password,activo,cuenta_acceso,documento_rut,telefono,
         propietario_email,direccion,localidad,departamento,observaciones
       ) VALUES (NULL,$1,NULL,TRUE,FALSE,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id_usuario,nombre,documento_rut,telefono,propietario_email AS email,
         direccion,localidad,departamento,observaciones`,
      [normalizado.nombre, normalizado.documento_rut ?? null, normalizado.telefono ?? null,
        normalizado.email ?? null, normalizado.direccion ?? null, normalizado.localidad ?? null,
        normalizado.departamento ?? null, normalizado.observaciones ?? null],
    );
    await client.query(
      "INSERT INTO usuario_rol (id_usuario,id_rol) VALUES ($1,$2)",
      [rows[0].id_usuario, roles[0].id_rol],
    );
    await client.query("COMMIT");
    return candidatoDesdeFila(rows[0], "propietario");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function obtenerPropietarioOperativo(
  idUsuario: number,
  db: Consultable = myPool,
): Promise<PropietarioOperativo | null> {
  const { rows } = await db.query(
    `SELECT u.id_usuario,u.nombre,u.documento_rut,u.telefono,
       u.propietario_email AS email,
       u.direccion,u.localidad,u.departamento,u.observaciones
     FROM usuario u
     JOIN usuario_rol ur ON ur.id_usuario=u.id_usuario
     JOIN rol r ON r.id_rol=ur.id_rol
     WHERE u.id_usuario=$1 AND u.activo=TRUE AND r.nombre='propietario'`,
    [idUsuario],
  );
  return rows[0] ? propietarioDesdeFila(rows[0] as Record<string, unknown>) : null;
}

export async function actualizarPropietarioOperativo(
  idUsuario: number,
  data: PropietarioOperativoActualizarBody,
  db: Consultable = myPool,
): Promise<PropietarioOperativo | null> {
  const normalizado = normalizarPropietario(data, false);
  const campos = ["nombre", "documento_rut", "telefono", "email", "direccion", "localidad", "departamento", "observaciones"] as const;
  const presente = (campo: typeof campos[number]) => Object.prototype.hasOwnProperty.call(data, campo);
  const { rows } = await db.query(
    `UPDATE usuario u SET
       nombre=CASE WHEN $2 THEN $3 ELSE u.nombre END,
       documento_rut=CASE WHEN $4 THEN $5 ELSE u.documento_rut END,
       telefono=CASE WHEN $6 THEN $7 ELSE u.telefono END,
       propietario_email=CASE WHEN $8 THEN $9 ELSE u.propietario_email END,
       direccion=CASE WHEN $10 THEN $11 ELSE u.direccion END,
       localidad=CASE WHEN $12 THEN $13 ELSE u.localidad END,
       departamento=CASE WHEN $14 THEN $15 ELSE u.departamento END,
       observaciones=CASE WHEN $16 THEN $17 ELSE u.observaciones END
     WHERE u.id_usuario=$1 AND u.activo=TRUE AND EXISTS (
       SELECT 1 FROM usuario_rol ur JOIN rol r ON r.id_rol=ur.id_rol
       WHERE ur.id_usuario=u.id_usuario AND r.nombre='propietario'
     )
     RETURNING u.id_usuario,u.nombre,u.documento_rut,u.telefono,u.propietario_email AS email,
       u.direccion,u.localidad,u.departamento,u.observaciones`,
    [idUsuario,
      presente("nombre"), normalizado.nombre,
      presente("documento_rut"), normalizado.documento_rut,
      presente("telefono"), normalizado.telefono,
      presente("email"), normalizado.email,
      presente("direccion"), normalizado.direccion,
      presente("localidad"), normalizado.localidad,
      presente("departamento"), normalizado.departamento,
      presente("observaciones"), normalizado.observaciones],
  );
  return rows[0] ? propietarioDesdeFila(rows[0] as Record<string, unknown>) : null;
}

async function candidatosPorRol(rol: string, db: Consultable, idUsuario?: number, busqueda?: string, limite = 20, idExacto?: number): Promise<CandidatoPozo[]> {
  const { rows } = await db.query(
    `SELECT u.id_usuario,u.nombre,u.documento_rut,u.telefono,u.propietario_email AS email,
       u.direccion,u.localidad,u.departamento,u.observaciones,ARRAY[$1::text] AS roles
     FROM usuario u
     JOIN usuario_rol ur ON ur.id_usuario = u.id_usuario
     JOIN rol r ON r.id_rol = ur.id_rol
     WHERE u.activo = true AND r.nombre = $1
       AND ($2::integer IS NULL OR u.id_usuario = $2)
       AND ($3::integer IS NULL OR u.id_usuario = $3)
       AND ($4::text IS NULL OR lower(u.nombre) LIKE '%' || lower($4) || '%'
         OR lower(COALESCE(u.documento_rut,'')) LIKE '%' || lower($4) || '%'
         OR lower(COALESCE(u.telefono,'')) LIKE '%' || lower($4) || '%'
         OR lower(COALESCE(CASE WHEN $1='propietario' THEN u.propietario_email ELSE u.email::text END,'')) LIKE '%' || lower($4) || '%')
      ORDER BY lower(u.nombre), lower(COALESCE(u.documento_rut,'')), u.id_usuario
      LIMIT $5`,
    [rol, idUsuario ?? null, idExacto ?? null, busqueda?.trim() || null, limite],
  );
  return rows.map((row) => candidatoDesdeFila(row as Record<string, unknown>, rol));
}

type PropietarioEntrada = Partial<PropietarioOperativoCrearBody> & { nombre?: string };

function normalizarPropietario(data: PropietarioEntrada, requiereNombre: boolean) {
  const nombre = data.nombre === undefined ? undefined : limpiar(data.nombre);
  if ((requiereNombre || data.nombre !== undefined) && !nombre)
    throw new err.T05DatosIncorrectos("El nombre y apellido del propietario es obligatorio.");
  const email = data.email === undefined ? undefined : limpiar(data.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
    throw new err.T05DatosIncorrectos("El email del propietario no es válido.");
  const departamento = data.departamento === undefined ? undefined : limpiar(data.departamento);
  if (departamento && !esDepartamentoUruguay(departamento))
    throw new err.T05DatosIncorrectos("El departamento del propietario no pertenece al catálogo de Uruguay.");
  return {
    nombre,
    documento_rut: data.documento_rut === undefined ? undefined : limpiar(data.documento_rut),
    telefono: data.telefono === undefined ? undefined : limpiar(data.telefono),
    email,
    direccion: data.direccion === undefined ? undefined : limpiar(data.direccion),
    localidad: data.localidad === undefined ? undefined : limpiar(data.localidad),
    departamento,
    observaciones: data.observaciones === undefined ? undefined : limpiar(data.observaciones),
  };
}

function limpiar(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  return valor.trim() || null;
}

function propietarioDesdeFila(row: Record<string, unknown>): PropietarioOperativo {
  return {
    id_usuario: Number(row.id_usuario), nombre: String(row.nombre),
    documento_rut: textoNullable(row.documento_rut), telefono: textoNullable(row.telefono),
    email: textoNullable(row.email), direccion: textoNullable(row.direccion),
    localidad: textoNullable(row.localidad), departamento: textoNullable(row.departamento) as PropietarioOperativo["departamento"],
    observaciones: textoNullable(row.observaciones),
  };
}

function candidatoDesdeFila(row: Record<string, unknown>, rol: string): CandidatoPozo {
  const propietario = propietarioDesdeFila(row);
  return {
    id_usuario: propietario.id_usuario, nombre: propietario.nombre,
    ...(propietario.documento_rut ? { documento_rut: propietario.documento_rut } : {}),
    ...(propietario.telefono ? { telefono: propietario.telefono } : {}),
    ...(propietario.email ? { email: propietario.email } : {}),
    ...(propietario.direccion ? { direccion: propietario.direccion } : {}),
    ...(propietario.localidad ? { localidad: propietario.localidad } : {}),
    ...(propietario.departamento ? { departamento: propietario.departamento } : {}),
    ...(propietario.observaciones ? { observaciones: propietario.observaciones } : {}),
    roles: Array.isArray(row.roles) ? row.roles.map(String) : [rol],
  };
}

function textoNullable(valor: unknown): string | null { return valor == null ? null : String(valor); }
