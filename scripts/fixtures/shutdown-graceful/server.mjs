import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;
const stateDir = process.env.RSP_TEST_STATE_DIR;
const photosDir = process.env.FOTOS_DIR;
const mode = process.env.RSP_TEST_MODE;
const delayMs = Number(process.env.RSP_TEST_DELAY_MS);
const statementTimeoutMs = Number(process.env.RSP_TEST_STATEMENT_TIMEOUT_MS);
const photo = join(photosDir, "fixture-photo.jpg");
const trashDir = join(photosDir, ".trash");
const isolated = join(trashDir, "fixture-photo.jpg.pending");
const originalBytes = Buffer.from("RSP-07F-R11 photo fixture\n", "utf8");
const originalSha256 = createHash("sha256").update(originalBytes).digest("hex");
const pool = new Pool();

async function marker(name, value = "ok") {
  await fs.writeFile(join(stateDir, name), `${value}\n`, "utf8");
}

await fs.mkdir(stateDir, { recursive: true });
await fs.mkdir(trashDir, { recursive: true });
await fs.writeFile(photo, originalBytes);
await pool.query("CREATE TABLE IF NOT EXISTS shutdown_photo_state (id integer PRIMARY KEY, path text)");
await pool.query(
  "INSERT INTO shutdown_photo_state (id, path) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET path = EXCLUDED.path",
  ["fixture-photo.jpg"],
);

let closing = false;
let shuttingDown;
const server = createServer(async (request, response) => {
  if (request.url === "/ready") {
    response.statusCode = closing ? 503 : 200;
    response.end(closing ? "closing" : "ready");
    return;
  }
  if (request.url !== "/mutate" || request.method !== "POST") {
    response.statusCode = 404;
    response.end("not found");
    return;
  }

  const client = await pool.connect();
  let transaction = false;
  let photoIsolated = false;
  try {
    await fs.rename(photo, isolated);
    photoIsolated = true;
    await marker("photo-isolated", originalSha256);
    await client.query("BEGIN");
    transaction = true;
    await client.query("UPDATE shutdown_photo_state SET path = NULL WHERE id = 1");
    if (mode === "timeout") {
      await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
      await client.query("SELECT pg_sleep(20)");
    } else {
      await client.query("SELECT pg_sleep($1)", [delayMs / 1000]);
    }
    if (mode === "error") throw new Error("controlled database failure");
    await client.query("COMMIT");
    transaction = false;
    await fs.unlink(isolated);
    photoIsolated = false;
    await marker("committed");
    response.statusCode = 204;
    response.end();
  } catch (error) {
    if (transaction) {
      await client.query("ROLLBACK");
      transaction = false;
    }
    if (photoIsolated) {
      await fs.rename(isolated, photo);
      photoIsolated = false;
    }
    await marker("compensated", error.code ?? error.message);
    response.statusCode = 500;
    response.end("compensated");
  } finally {
    client.release();
  }
});
// Fastify production cierra conexiones idle durante shutdown. Acotamos el
// keep-alive del fixture para modelar ese contrato sin cortar la request activa.
server.keepAliveTimeout = 500;

async function shutdown(signal) {
  if (shuttingDown) return shuttingDown;
  closing = true;
  shuttingDown = (async () => {
    await marker("sigterm", signal);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await pool.end();
    await marker("clean-exit");
  })();
  return shuttingDown;
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
server.listen(3000, "0.0.0.0", () => void marker("ready", originalSha256));
