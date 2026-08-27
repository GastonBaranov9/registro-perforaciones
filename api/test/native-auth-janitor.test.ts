import assert from "node:assert/strict";
import test from "node:test";
import { cargarConfiguracionRuntime } from "../src/config/runtime.ts";
import {
  NativeAuthJanitor,
  type NativeJanitorDb,
  type NativeJanitorLogger,
} from "../src/services/native-auth-janitor.ts";

const logger: NativeJanitorLogger = {
  info() {},
  warn() {},
  error() {},
};

test("janitor limpia tickets antes que sesiones con lotes indexables", async () => {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const rowCounts = [500, 2];
  const db: NativeJanitorDb = {
    async query(text, values) {
      queries.push({ text, values });
      return { rowCount: rowCounts.shift() ?? 0 };
    },
  };
  const config = cargarConfiguracionRuntime({
    NODE_ENV: "test",
    NATIVE_AUTH_JANITOR_BATCH_SIZE: "500",
  });
  const janitor = new NativeAuthJanitor(db, config, logger);
  const result = await janitor.sweep();
  assert.deepEqual(result, {
    ticketsDeleted: 500,
    sessionsDeleted: 2,
    hasBacklog: true,
  });
  assert.match(queries[0].text, /DELETE FROM ticket_ws_nativo/);
  assert.match(queries[0].text, /ORDER BY expires_at ASC/);
  assert.match(queries[1].text, /DELETE FROM sesion_nativa/);
  assert.match(queries[1].text, /COALESCE\(revoked_at, expires_at\)/);
  assert.deepEqual(queries[0].values, [60, 500]);
  assert.deepEqual(queries[1].values, [30, 500]);
});

test("startup exitoso habilita readiness y no duplica schedulers", async () => {
  let calls = 0;
  const db: NativeJanitorDb = {
    async query() {
      calls += 1;
      return { rowCount: 0 };
    },
  };
  const config = cargarConfiguracionRuntime({ NODE_ENV: "test" });
  const janitor = new NativeAuthJanitor(db, config, logger);
  await janitor.start();
  await janitor.start();
  assert.equal(calls, 2);
  assert.equal(janitor.isReady(), true);
  assert.equal(janitor.canEmitWsTickets(), true);
  assert.equal(janitor.status.consecutiveFailures, 0);
  janitor.stop();
});

test("fallo del sweep inicial degrada readiness y suspende nuevos tickets", async () => {
  const db: NativeJanitorDb = {
    async query() {
      throw new Error("detalle sensible de DB");
    },
  };
  const config = cargarConfiguracionRuntime({ NODE_ENV: "test" });
  const janitor = new NativeAuthJanitor(db, config, logger);
  await janitor.start();
  assert.equal(janitor.status.initialSweepComplete, false);
  assert.equal(janitor.status.degraded, true);
  assert.equal(janitor.isReady(), false);
  assert.equal(janitor.canEmitWsTickets(), false);
  janitor.stop();
});
