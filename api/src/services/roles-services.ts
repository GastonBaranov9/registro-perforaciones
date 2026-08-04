import { myPool } from "../db/pool.ts";
import { Rol, RolBody, Usuario } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
export async function changeRol(
  id_usuario: number,
  id_rol: number
): Promise<void> {
  const client = await myPool.connect();
  let discardClient = false;

  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT id_usuario FROM usuario WHERE id_usuario = $1 FOR UPDATE`,
      [id_usuario]
    );
    await client.query(
      `SELECT pg_advisory_xact_lock($1::integer, $2::integer)`,
      [id_usuario, id_rol]
    );

    const { rows } = await client.query(
      `SELECT 1 FROM usuario_rol WHERE id_usuario = $1 AND id_rol = $2`,
      [id_usuario, id_rol]
    );

    if (rows.length > 0) {
      await client.query(
        `DELETE FROM usuario_rol WHERE id_usuario = $1 AND id_rol = $2`,
        [id_usuario, id_rol]
      );
    } else {
      await client.query(
        `INSERT INTO usuario_rol (id_usuario, id_rol) VALUES ($1, $2)`,
        [id_usuario, id_rol]
      );
    }

    await client.query(
      `UPDATE usuario SET version_sesion = version_sesion + 1 WHERE id_usuario = $1`,
      [id_usuario]
    );

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }

    throw error;
  } finally {
    if (discardClient) {
      client.release(true);
    } else {
      client.release();
    }
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
        RETURNING id_rol, nombre, descr;
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
  const client = await myPool.connect();
  try {
    await client.query("BEGIN");
    const { rows: actuales } = await client.query<{ nombre: string }>(
      `SELECT nombre FROM rol WHERE id_rol = $1 FOR UPDATE`,
      [id_rol]
    );
    if (!actuales[0]) {
      await client.query("ROLLBACK");
      return null;
    }

    const { rows } = await client.query<Rol>(
      `
        UPDATE rol
        SET nombre = $2, descr = $3
        WHERE id_rol = $1
        RETURNING id_rol, nombre, descr;
      `,
      [id_rol, data.nombre, data.descr]
    );

    if (actuales[0].nombre !== data.nombre) {
      await client.query(
        `
          UPDATE usuario
          SET version_sesion = version_sesion + 1
          WHERE id_usuario IN (
            SELECT id_usuario FROM usuario_rol WHERE id_rol = $1
          );
        `,
        [id_rol]
      );
    }

    await client.query("COMMIT");
    return rows[0] ?? null;
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteRol(id_rol: number): Promise<Boolean> {
  const client = await myPool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id_rol FROM rol WHERE id_rol = $1 FOR UPDATE`,
      [id_rol]
    );
    if (!rows[0]) throw new err.T05RolNoEncontrado();

    await client.query(
      `
        UPDATE usuario
        SET version_sesion = version_sesion + 1
        WHERE id_usuario IN (
          SELECT id_usuario FROM usuario_rol WHERE id_rol = $1
        );
      `,
      [id_rol]
    );
    await client.query(`DELETE FROM rol WHERE id_rol = $1`, [id_rol]);
    await client.query("COMMIT");
    return true;
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getRolById(id_rol: number): Promise<Rol> {
  const { rows } = await myPool.query(
    `
    SELECT id_rol, nombre, descr
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
    SELECT id_rol, nombre, descr
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
