import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { cargarConfigDbOperaciones } from "../db/operaciones-config.ts";
import { crearPrimerAdministrador } from "../services/bootstrap-admin-service.ts";

function quitarSaltoFinal(valor: string): string {
  return valor.endsWith("\r\n") ? valor.slice(0, -2) : valor.endsWith("\n") ? valor.slice(0, -1) : valor;
}

async function leerArchivoPassword(ruta: string): Promise<string> {
  if (process.env.NODE_ENV === "production" && !path.isAbsolute(ruta))
    throw new Error("ADMIN_PASSWORD_FILE debe ser una ruta absoluta en producción");
  const estado = await fs.lstat(ruta);
  if (!estado.isFile() || estado.size > 4_096) throw new Error("ADMIN_PASSWORD_FILE no es un archivo secreto válido");
  return quitarSaltoFinal(await fs.readFile(ruta, "utf8"));
}

async function leerStdin(): Promise<string> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of process.stdin) {
    const bytes = Buffer.isBuffer(parte) ? parte : Buffer.from(parte);
    total += bytes.length;
    if (total > 4_096) throw new Error("La contraseña recibida por stdin excede el máximo permitido");
    partes.push(bytes);
  }
  return quitarSaltoFinal(Buffer.concat(partes).toString("utf8"));
}

async function obtenerPassword(): Promise<string> {
  const porArchivo = process.env.ADMIN_PASSWORD_FILE?.trim();
  const porStdin = process.argv.includes("--password-stdin");
  const porEnv = process.env.ADMIN_PASSWORD;
  const fuentes = Number(Boolean(porArchivo)) + Number(porStdin) + Number(porEnv !== undefined);
  if (fuentes !== 1)
    throw new Error("Configure exactamente una fuente: ADMIN_PASSWORD_FILE o --password-stdin");
  if (porArchivo) return leerArchivoPassword(porArchivo);
  if (porStdin) return leerStdin();
  if (process.env.NODE_ENV === "production")
    throw new Error("ADMIN_PASSWORD directo no está permitido en producción; use archivo o stdin");
  return porEnv!;
}

let pool: Pool | undefined;
try {
  const argumentosInvalidos = process.argv.slice(2).filter((x) => x !== "--password-stdin");
  if (argumentosInvalidos.length) throw new Error("Argumento bootstrap no reconocido");
  const email = process.env.ADMIN_EMAIL?.trim() ?? "";
  const nombre = process.env.ADMIN_NAME?.trim() ?? "";
  const password = await obtenerPassword();
  pool = new Pool(cargarConfigDbOperaciones());
  await crearPrimerAdministrador(pool, { email, nombre, password });
  console.log("Administrador inicial creado.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falló el bootstrap del administrador");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
