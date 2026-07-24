import { myPool } from "../db/pool.ts";
import { Usuario } from "../models/schemas.ts";
import * as err from "../models/errors.ts";

export async function registerUser(
  data: Omit<Usuario, "id_usuario" | "activo" | "fecha_registro">
): Promise<Usuario> {
  const sql = `INSERT INTO usuario (email, nombre, password)
VALUES ($1,$2,$3)
RETURNING *; 
`;

  const vals = [data.email, data.nombre, data.password];
  const { rows } = await myPool.query(sql, vals);
  return rows[0] as Usuario;
}

export async function logUser(
  email: string,
  plain: string
): Promise<Usuario | null> {
  try{

  
  const sql = `
SELECT id_usuario, email, nombre
    FROM usuario
    WHERE email = $1
      AND password = $2
      AND activo = TRUE
    LIMIT 1;
  `;

  const res = await myPool.query(sql, [email, plain]);
  if (res.rowCount === 0) throw new err.T05DatosIncorrectos();
  return res.rows[0] as Usuario;
  }catch(error:any){
    throw error;
  }
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
      WHERE ur.id_usuario = $1 AND LOWER(r.nombre) = LOWER($2)
      `,
    [id_usuario, rol_nombre]
  );
  return rows.length > 0;
}
