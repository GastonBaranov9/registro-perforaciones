import type { PoolConfig } from "pg";

function requerida(env: NodeJS.ProcessEnv, nombre: string): string {
  const valor = env[nombre]?.trim();
  if (!valor) throw new Error(`Falta configurar ${nombre}`);
  return valor;
}

export function cargarConfigDbOperaciones(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const portText = requerida(env, "PGPORT");
  if (!/^\d+$/.test(portText)) throw new Error("PGPORT debe ser un puerto válido");
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("PGPORT debe ser un puerto válido");

  return {
    host: requerida(env, "PGHOST"),
    port,
    user: requerida(env, "PGUSER"),
    password: requerida(env, "PGPASSWORD"),
    database: requerida(env, "PGDATABASE"),
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  };
}
