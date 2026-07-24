import { myPool } from "../db/pool.ts";
import { Usuario, UsuarioRegister, UsuarioBody } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { getRoles } from "./roles-services.ts";
export async function createUsuario(data: UsuarioBody): Promise<Usuario> {
  const sql = `
        INSERT INTO usuario
          (email, nombre, password, activo)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
      `;
  try {
    const { rows } = await myPool.query(sql, [
      data.email,
      data.nombre,
      data.password,
      data.activo,
    ]);
    const usuario = rows[0] as Usuario;

    if (!data.roles) throw err.T05RolNoEncontrado();

    for (const rol of data.roles) {
      await myPool.query(
        `INSERT INTO usuario_rol (id_usuario, id_rol)
         VALUES ($1, $2);`,
        [usuario.id_usuario, rol.id_rol]
      );
    }

    return usuario;
  } catch (e: any) {
    throw e;
  }
}

export async function updateUsuario(
  data: UsuarioBody,
  id_usuario: number
): Promise<Usuario | null> {
  const exists = await myPool.query(
    `SELECT 1 FROM usuario WHERE id_usuario = $1`,
    [id_usuario]
  );
  if (!exists.rows[0]) return null;

  const sql = `
    UPDATE usuario
    SET
      email = $2,
      nombre = $3,
      password = $4,
      activo = $5
    WHERE id_usuario = $1
    RETURNING *;
  `;
  try {
    const { rows } = await myPool.query(sql, [
      id_usuario,
      data.email,
      data.nombre,
      data.password,
      data.activo,
    ]);
    const usuario = rows[0] ?? null;
    if (!data.roles) throw err.T05RolNoEncontrado();

    await myPool.query("DELETE FROM usuario_rol WHERE id_usuario = $1;", [
      id_usuario,
    ]);
    
    for (const rol of data.roles) {
      await myPool.query(
        `INSERT INTO usuario_rol (id_usuario, id_rol)
         VALUES ($1, $2);`,
        [id_usuario, rol.id_rol]
      );
    }
    return usuario;
  } catch (e: any) {
    throw e;
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
): Promise<Usuario | null> {
  const { rows } = await myPool.query(
    `
    SELECT *
    FROM usuario
    WHERE id_usuario = $1
    `,
    [id_usuario]
  );
  const usuario = rows[0];
  if (!usuario) throw new err.T05UsuarioNoEncontrado;

  const roles = await getRoles(id_usuario);
  return {
    ...usuario,
    roles,
  };
}

export async function getAllUsuarios(): Promise<Usuario[]> {
  const { rows } = await myPool.query(
    `
    SELECT *
    FROM usuario
    `
  );

  const usuariosConRoles = await Promise.all(
    rows.map(async (u) => {
      const roles = await getRoles(u.id_usuario);
      return { ...u, roles };
    })
  );

  return usuariosConRoles;
}
