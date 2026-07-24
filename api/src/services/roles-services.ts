import { myPool } from "../db/pool.ts";
import { Rol, RolBody, Usuario } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
export async function changeRol(
  id_usuario: number,
  id_rol: number
): Promise<void> {
  try {
    const { rows } = await myPool.query(
      `SELECT 1 FROM usuario_rol WHERE id_usuario = $1 AND id_rol = $2`,
      [id_usuario, id_rol]
    );
    if (rows.length > 0) {
      await myPool.query(
        `DELETE FROM usuario_rol WHERE id_usuario = $1 AND id_rol = $2`,
        [id_usuario, id_rol]
      );
    } else {
      await myPool.query(
        `INSERT INTO usuario_rol (id_usuario, id_rol) VALUES ($1, $2)`,
        [id_usuario, id_rol]
      );
    }
  } catch (e) {
    console.error(e);
  }
}

export async function getRoles(id_usuario: number): Promise<Rol[]> {
  const sql = `SELECT r.id_rol, r.nombre, r.descr
       FROM rol r
       JOIN usuario_rol ur ON ur.id_rol = r.id_rol
       WHERE ur.id_usuario = $1`;
  try {
    const { rows } = await myPool.query(sql, [id_usuario]);

    return rows;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

export async function createRol(data: RolBody): Promise<Rol> {
  const sql = `
        INSERT INTO rol
          (nombre, descr)
        VALUES ($1, $2)
        RETURNING *;
      `;
  try {
    const { rows } = await myPool.query(sql, [data.nombre, data.descr]);
    return rows[0] as Rol;
  } catch (e: any) {
    throw e;
  }
}

export async function updateRol(
  data: RolBody,
  id_rol: number
): Promise<Rol | null> {
  const exists = await myPool.query(`SELECT 1 FROM rol WHERE id_rol = $1`, [
    id_rol,
  ]);
  if (!exists.rows[0]) return null;

  const sql = `
    UPDATE rol
    SET
      nombre = $2,
      descr = $3
    WHERE id_rol = $1
    RETURNING *;
  `;
  try {
    const { rows } = await myPool.query(sql, [id_rol, data.nombre, data.descr]);
    return rows[0] ?? null;
  } catch (e: any) {
    throw e;
  }
}

export async function deleteRol(id_rol: number): Promise<Boolean> {
  const { rowCount } = await myPool.query(
    `
    DELETE FROM rol
    WHERE id_rol = $1
    `,
    [id_rol]
  );
  if (rowCount === 0) throw new err.T05RolNoEncontrado();
  return (rowCount ?? 0) > 0;
}

export async function getRolById(id_rol: number): Promise<Rol> {
  const { rows } = await myPool.query(
    `
    SELECT *
    FROM rol
    WHERE id_rol = $1
    `,
    [id_rol]
  );
  return rows[0] ?? null;
}

export async function getAllRoles(): Promise<Rol[]> {
  const { rows } = await myPool.query(
    `
    SELECT *
    FROM rol
    `
  );
  return rows;
}

export async function isProp(id_propietario: number): Promise<boolean> {
  const rolesIdProp = await getRoles(id_propietario);

  for (const rol of rolesIdProp) {
    if (rol.nombre === "propietario") {
      return true;
    }
  }
  return false;
}

export async function isPerf(id_perforador: number): Promise<boolean> {
  const rolesIdPerf = await getRoles(id_perforador);

  for (const rol of rolesIdPerf) {
    if (rol.nombre === "perforador") {
      return true;
    }
  }
  return false;
}

export async function isAdmin(id_usuario: number): Promise<boolean> {
  const rolesIdPerf = await getRoles(id_usuario);

  for (const rol of rolesIdPerf) {
    if (rol.nombre === "administracion") {
      return true;
    }
  }
  return false;
}
