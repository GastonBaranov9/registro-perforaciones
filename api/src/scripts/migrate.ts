import { Pool } from "pg";
import { cargarConfigDbOperaciones } from "../db/operaciones-config.ts";
import { ejecutarMigraciones } from "../db/migrator.ts";

const argumentos = new Set(process.argv.slice(2));
const permitidos = new Set(["--adopt-current-schema"]);
const desconocido = [...argumentos].find((x) => !permitidos.has(x));

let pool: Pool | undefined;
try {
  if (desconocido) throw new Error(`Argumento no reconocido: ${desconocido}`);
  pool = new Pool(cargarConfigDbOperaciones());
  const resultado = await ejecutarMigraciones(pool, {
    adoptarEsquemaActual: argumentos.has("--adopt-current-schema"),
    directorio: process.env.MIGRATIONS_DIR,
  });
  console.log(`Migraciones completas. Aplicadas: ${resultado.aplicadas.length}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falló el runner de migraciones");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
