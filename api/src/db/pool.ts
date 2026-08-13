import type { PoolConfig } from "pg";
import { Pool } from "pg";
import { cargarConfiguracionRuntime } from "../config/runtime.ts";

const runtime = cargarConfiguracionRuntime();

export const pgConfig: PoolConfig = {
  user: runtime.postgres.user,
  password: runtime.postgres.password,
  host: runtime.postgres.host,
  port: runtime.postgres.port,
  database: runtime.postgres.database,
  connectionTimeoutMillis: 0,
  idleTimeoutMillis: 10000,
  max: 10,
  min: 0,
  allowExitOnIdle: false,
  maxLifetimeSeconds: 0,
};

export const myPool = new Pool(pgConfig);
