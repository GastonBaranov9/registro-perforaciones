import { myPool } from "../db/pool.ts";
import { hashPassword } from "../services/password-service.ts";

const adminEmail = process.env.ADMIN_EMAIL?.trim();
const adminName = process.env.ADMIN_NAME?.trim();
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminEmail || !adminName || !adminPassword) {
  console.error(
    "Faltan ADMIN_EMAIL, ADMIN_NAME o ADMIN_PASSWORD."
  );
  process.exitCode = 1;
} else {
  const client = await myPool.connect();

  try {
    await client.query("BEGIN");

    const roles = [
      ["administracion", "Administración general del sistema"],
      ["perforador", "Registro y gestión técnica de perforaciones"],
      ["propietario", "Consulta de perforaciones propias"],
    ];

    for (const [nombre, descr] of roles) {
      await client.query(
        `
          INSERT INTO rol (nombre, descr)
          VALUES ($1, $2)
          ON CONFLICT (nombre)
          DO UPDATE SET descr = EXCLUDED.descr;
        `,
        [nombre, descr]
      );
    }

    const passwordHash = await hashPassword(adminPassword);

    const { rows: usuarios } = await client.query(
      `
        INSERT INTO usuario (email, nombre, password, activo)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT (email)
        DO UPDATE SET
          nombre = EXCLUDED.nombre,
          password = EXCLUDED.password,
          activo = TRUE,
          version_sesion = usuario.version_sesion + 1
        RETURNING id_usuario;
      `,
      [adminEmail, adminName, passwordHash]
    );

    const idUsuario = usuarios[0].id_usuario;

    const { rows: rolesAdmin } = await client.query(
      `
        SELECT id_rol
        FROM rol
        WHERE nombre = 'administracion';
      `
    );

    await client.query(
      `
        INSERT INTO usuario_rol (id_usuario, id_rol)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING;
      `,
      [idUsuario, rolesAdmin[0].id_rol]
    );

    await client.query("COMMIT");

    console.log("Administrador preparado.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("No se pudo preparar el administrador:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await myPool.end();
  }
}
