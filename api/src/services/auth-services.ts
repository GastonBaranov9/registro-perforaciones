import { myPool } from "../db/pool.ts";
import type { Usuario } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { hashPassword, verifyPassword } from "./password-service.ts";

type AuthenticatedUser = Pick<
  Usuario,
  "id_usuario" | "email" | "nombre"
>;

export async function registerUser(
  data: Omit<Usuario, "id_usuario" | "activo" | "fecha_registro">
): Promise<Usuario> {
  const passwordHash = await hashPassword(data.password);

  const sql = `
    INSERT INTO usuario (email, nombre, password)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;

  const values = [data.email, data.nombre, passwordHash];
  const { rows } = await myPool.query(sql, values);

  return rows[0] as Usuario;
}

export async function logUser(
  email: string,
  plainPassword: string
): Promise<AuthenticatedUser> {
  const sql = `
    SELECT id_usuario, email, nombre, password
    FROM usuario
    WHERE email = $1
      AND activo = TRUE
    LIMIT 1;
  `;

  const { rows } = await myPool.query(sql, [email]);
  const user = rows[0] as
    | Pick<Usuario, "id_usuario" | "email" | "nombre" | "password">
    | undefined;

  if (!user) {
    throw new err.T05DatosIncorrectos();
  }

  const passwordIsValid = await verifyPassword(
    plainPassword,
    user.password
  );

  if (!passwordIsValid) {
    throw new err.T05DatosIncorrectos();
  }

  return {
    id_usuario: user.id_usuario,
    email: user.email,
    nombre: user.nombre,
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
