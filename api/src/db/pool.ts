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
  connectionTimeoutMillis: runtime.postgres.connectionTimeoutMs,
  idleTimeoutMillis: 10000,
  max: runtime.postgres.poolMax,
  min: 0,
  allowExitOnIdle: false,
  maxLifetimeSeconds: 0,
  statement_timeout: runtime.postgres.statementTimeoutMs,
  idle_in_transaction_session_timeout: runtime.postgres.idleTransactionTimeoutMs,
  query_timeout: runtime.postgres.queryTimeoutMs,
};

export const myPool = new Pool(pgConfig);
