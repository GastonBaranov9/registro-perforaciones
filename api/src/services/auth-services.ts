import { myPool } from "../db/pool.ts";
import type { Usuario } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import {verifyPassword } from "./password-service.ts";
import { cerrarConexionesUsuario } from "../plugins/websocket.ts";

type AuthenticatedUser = Pick<
  Usuario,
  "id_usuario" | "email" | "nombre" | "version_sesion"
>;

export type EstadoSesionUsuario = Pick<Usuario, "activo" | "version_sesion">;



export async function logUser(
  email: string,
  plainPassword: string
): Promise<AuthenticatedUser> {
  const sql = `
    SELECT id_usuario, email, nombre, password, version_sesion
    FROM usuario
    WHERE email = $1
      AND activo = TRUE
      AND cuenta_acceso = TRUE
      AND password IS NOT NULL
    LIMIT 1;
  `;

  const { rows } = await myPool.query(sql, [email]);
  const user = rows[0] as
    | Pick<Usuario, "id_usuario" | "email" | "nombre" | "password" | "version_sesion">
    | undefined;

  if (!user) {
    throw new err.T05CredencialesInvalidas();
  }

  const passwordIsValid = await verifyPassword(
    plainPassword,
    user.password
  );

  if (!passwordIsValid) {
    throw new err.T05CredencialesInvalidas();
  }

  return {
    id_usuario: user.id_usuario,
    email: user.email,
    nombre: user.nombre,
    version_sesion: user.version_sesion,
  };
}

export async function rolUser(
  id_usuario: number,
  rol_nombre: string
): Promise<boolean> {
  const { rows } = await myPool.query(
    `
      SELECT 1
      FROM usuario_rol ur
      JOIN rol r ON ur.id_rol = r.id_rol
      WHERE ur.id_usuario = $1
        AND LOWER(r.nombre) = LOWER($2)
    `,
    [id_usuario, rol_nombre]
  );

  return rows.length > 0;
}

export async function getEstadoSesionUsuario(
  id_usuario: number
): Promise<EstadoSesionUsuario | null> {
  const { rows } = await myPool.query(
    `
      SELECT activo, version_sesion
      FROM usuario
      WHERE id_usuario = $1
      LIMIT 1;
    `,
    [id_usuario]
  );

  return (rows[0] as EstadoSesionUsuario | undefined) ?? null;
}

export async function revocarSesionesUsuario(
  idUsuario: number,
  pool: Pick<typeof myPool, "query"> = myPool,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE usuario
     SET version_sesion = version_sesion + 1
     WHERE id_usuario = $1 AND activo = TRUE`,
    [idUsuario],
  );
  if (rowCount === 1) cerrarConexionesUsuario(idUsuario);
  return rowCount === 1;
}
