import { myPool } from "../db/pool.ts";
import type {
  Rol,
  UsuarioCrearBody,
  UsuarioPublico,
  UsuarioActualizarBody
} from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { hashPassword } from "./password-service.ts";

type UsuarioPublicoSinRoles = Omit<UsuarioPublico, "roles">;

export function canonicalizarIdsRol(roles: readonly Pick<Rol, "id_rol">[]): number[] {
  return Array.from(new Set(roles.map((rol) => Number(rol.id_rol)))).sort(
    (a, b) => a - b
  );
}

export function mismosIdsRol(actuales: readonly number[], nuevos: readonly number[]): boolean {
  if (actuales.length !== nuevos.length) return false;
  return actuales.every((idRol, index) => idRol === nuevos[index]);
}

export function debeRevocarSesion(params: {
  passwordCambiado: boolean;
  estabaActivo: boolean;
  quedaActivo: boolean;
  rolesCambiaron: boolean;
}): boolean {
  return (
    params.passwordCambiado ||
    (params.estabaActivo && !params.quedaActivo) ||
    params.rolesCambiaron
  );
}


export async function createUsuario(
  data: UsuarioCrearBody
): Promise<UsuarioPublico> {
  const client = await myPool.connect();

  try {
    await client.query("BEGIN");

    const passwordHash = await hashPassword(data.password);

    const { rows } = await client.query<UsuarioPublicoSinRoles>(
      `
        INSERT INTO usuario
          (email, nombre, password, activo)
        VALUES ($1, $2, $3, $4)
        RETURNING
          id_usuario,
          email,
          nombre,
          activo,
          fecha_registro;
      `,
      [
        data.email,
        data.nombre,
        passwordHash,
        data.activo,
      ]
    );

    const usuario = rows[0];

    for (const rol of data.roles) {
      await client.query(
        `
          INSERT INTO usuario_rol
            (id_usuario, id_rol)
          VALUES ($1, $2);
        `,
        [usuario.id_usuario, rol.id_rol]
      );
    }

    const { rows: roles } = await client.query<Rol>(
      `
        SELECT
          r.id_rol,
          r.nombre,
          r.descr
        FROM rol r
        JOIN usuario_rol ur
          ON ur.id_rol = r.id_rol
        WHERE ur.id_usuario = $1
        ORDER BY r.id_rol;
      `,
      [usuario.id_usuario]
    );

    await client.query("COMMIT");

    return {
      ...usuario,
      roles,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUsuario(
  data: UsuarioActualizarBody,
  id_usuario: number
): Promise<UsuarioPublico | null> {
  const client = await myPool.connect();

  try {
    await client.query("BEGIN");

    const { rows: estados } = await client.query<{ activo: boolean }>(
      `SELECT activo FROM usuario WHERE id_usuario = $1 FOR UPDATE`,
      [id_usuario]
    );
    const estadoAnterior = estados[0];
    if (!estadoAnterior) {
      await client.query("ROLLBACK");
      return null;
    }

    const { rows: rolesAnteriores } = await client.query<{ id_rol: number }>(
      `SELECT id_rol FROM usuario_rol WHERE id_usuario = $1 ORDER BY id_rol`,
      [id_usuario]
    );
    const idsAnteriores = rolesAnteriores.map((rol) => Number(rol.id_rol));
    const idsNuevos = canonicalizarIdsRol(data.roles);
    const rolesCambiaron = !mismosIdsRol(idsAnteriores, idsNuevos);
    const passwordHash =
      data.password === undefined ? null : await hashPassword(data.password);
    const debeRevocar = debeRevocarSesion({
      passwordCambiado: passwordHash !== null,
      estabaActivo: estadoAnterior.activo,
      quedaActivo: data.activo,
      rolesCambiaron,
    });

    const { rows } = await client.query<UsuarioPublicoSinRoles>(
      `
        UPDATE usuario
        SET
          email = $2,
          nombre = $3,
          activo = $4,
          password = COALESCE($5, password),
          version_sesion = version_sesion + CASE WHEN $6 THEN 1 ELSE 0 END
        WHERE id_usuario = $1
        RETURNING id_usuario, email, nombre, activo, fecha_registro;
      `,
      [id_usuario, data.email, data.nombre, data.activo, passwordHash, debeRevocar]
    );
    const usuario = rows[0];

    if (rolesCambiaron) {
      await client.query(
        `DELETE FROM usuario_rol WHERE id_usuario = $1`,
        [id_usuario]
      );

      for (const idRol of idsNuevos) {
        await client.query(
          `INSERT INTO usuario_rol (id_usuario, id_rol) VALUES ($1, $2)`,
          [id_usuario, idRol]
        );
      }
    }

    const { rows: roles } = await client.query<Rol>(
      `
        SELECT
          r.id_rol,
          r.nombre,
          r.descr
        FROM rol r
        JOIN usuario_rol ur
          ON ur.id_rol = r.id_rol
        WHERE ur.id_usuario = $1
        ORDER BY r.id_rol;
      `,
      [id_usuario]
    );

    await client.query("COMMIT");

    return {
      ...usuario,
      roles,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteUsuario(id_usuario: number): Promise<Boolean> {
  const { rowCount } = await myPool.query(
    `
    DELETE FROM usuario
    WHERE id_usuario = $1
    `,
    [id_usuario]
  );
  if (rowCount === 0) throw new err.T05UsuarioNoEncontrado();
  return (rowCount ?? 0) > 0;
}

export async function getUsuarioById(
  id_usuario: number
): Promise<UsuarioPublico | null> {
  const { rows } = await myPool.query<UsuarioPublico>(
    `
      SELECT
        u.id_usuario,
        u.email,
        u.nombre,
        u.activo,
        u.fecha_registro,
        COALESCE(
          json_agg(
            json_build_object(
              'id_rol', r.id_rol,
              'nombre', r.nombre,
              'descr', r.descr
            )
            ORDER BY r.id_rol
          ) FILTER (WHERE r.id_rol IS NOT NULL),
          '[]'::json
        ) AS roles
      FROM usuario u
      LEFT JOIN usuario_rol ur
        ON ur.id_usuario = u.id_usuario
      LEFT JOIN rol r
        ON r.id_rol = ur.id_rol
      WHERE u.id_usuario = $1
      GROUP BY
        u.id_usuario,
        u.email,
        u.nombre,
        u.activo,
        u.fecha_registro;
    `,
    [id_usuario]
  );

  return rows[0] ?? null;
}

export async function getAllUsuarios(): Promise<UsuarioPublico[]> {
  const { rows } = await myPool.query<UsuarioPublico>(
    `
      SELECT
        u.id_usuario,
        u.email,
        u.nombre,
        u.activo,
        u.fecha_registro,
        COALESCE(
          json_agg(
            json_build_object(
              'id_rol', r.id_rol,
              'nombre', r.nombre,
              'descr', r.descr
            )
            ORDER BY r.id_rol
          ) FILTER (WHERE r.id_rol IS NOT NULL),
          '[]'::json
        ) AS roles
      FROM usuario u
      LEFT JOIN usuario_rol ur
        ON ur.id_usuario = u.id_usuario
      LEFT JOIN rol r
        ON r.id_rol = ur.id_rol
      GROUP BY
        u.id_usuario,
        u.email,
        u.nombre,
        u.activo,
        u.fecha_registro
      ORDER BY u.id_usuario;
    `
  );

  return rows;
}
