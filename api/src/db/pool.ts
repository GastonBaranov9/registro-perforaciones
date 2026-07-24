import type { PoolConfig } from "pg";
import { Pool } from "pg";

export const pgConfig: PoolConfig = {
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  connectionTimeoutMillis: 0,
  idleTimeoutMillis: 10000,
  max: 10,
  min: 0,
  allowExitOnIdle: false,
  maxLifetimeSeconds: 0,
};

export const myPool = new Pool(pgConfig);
