import { hashPassword } from "./password-service.ts";

const BOOTSTRAP_LOCK_CLASE = 707;
const BOOTSTRAP_LOCK_OBJETO = 9;

export interface EntradaBootstrapAdmin {
  email: string;
  nombre: string;
  password: string;
}

export interface BootstrapClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parametros?: unknown[],
  ): Promise<{ rows: T[] }>;
  release(): void;
}

export interface BootstrapPool {
  connect(): Promise<BootstrapClient>;
}

export class BootstrapAdminError extends Error {}

export function validarEntradaBootstrap(entrada: EntradaBootstrapAdmin): EntradaBootstrapAdmin {
  const email = entrada.email.trim();
  const nombre = entrada.nombre.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new BootstrapAdminError("ADMIN_EMAIL no es un email válido");
  if (!nombre || nombre.length > 200) throw new BootstrapAdminError("ADMIN_NAME no es válido");
  if (entrada.password.length < 8 || !/\S/.test(entrada.password))
    throw new BootstrapAdminError("La contraseña bootstrap no cumple la política vigente");
  return { email, nombre, password: entrada.password };
}

export async function crearPrimerAdministrador(
  pool: BootstrapPool,
  entradaSinValidar: EntradaBootstrapAdmin,
  hasher: (password: string) => Promise<string> = hashPassword,
): Promise<void> {
  const entrada = validarEntradaBootstrap(entradaSinValidar);
  const passwordHash = await hasher(entrada.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [BOOTSTRAP_LOCK_CLASE, BOOTSTRAP_LOCK_OBJETO]);
    const administradores = await client.query(`
      SELECT 1
      FROM usuario u
      JOIN usuario_rol ur ON ur.id_usuario=u.id_usuario
      JOIN rol r ON r.id_rol=ur.id_rol
      WHERE lower(r.nombre)='administracion'
      LIMIT 1
    `);
    if (administradores.rows.length)
      throw new BootstrapAdminError("Ya existe un administrador; bootstrap rechazado");

    const roles = await client.query<{ id_rol: string | number }>(
      "SELECT id_rol FROM rol WHERE nombre='administracion' LIMIT 1",
    );
    if (!roles.rows[0]) throw new BootstrapAdminError("Falta el rol administracion; ejecute migraciones primero");

    let usuario: { id_usuario: string | number };
    try {
      const creados = await client.query<{ id_usuario: string | number }>(`
        INSERT INTO usuario(email,nombre,password,activo,cuenta_acceso)
        VALUES($1,$2,$3,TRUE,TRUE)
        RETURNING id_usuario
      `, [entrada.email, entrada.nombre, passwordHash]);
      usuario = creados.rows[0];
      if (!usuario) throw new Error("INSERT sin fila");
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new BootstrapAdminError("El email bootstrap ya pertenece a otra cuenta");
      throw error;
    }

    await client.query(
      "INSERT INTO usuario_rol(id_usuario,id_rol) VALUES($1,$2)",
      [usuario.id_usuario, roles.rows[0].id_rol],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof BootstrapAdminError) throw error;
    throw new BootstrapAdminError("No se pudo crear el administrador inicial");
  } finally {
    client.release();
  }
}
