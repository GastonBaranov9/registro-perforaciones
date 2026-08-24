import fastify from "fastify";
import type { FastifyInstance, FastifyListenOptions } from "fastify";
import autoLoad from "@fastify/autoload";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { cargarConfiguracionRuntime, prepararDirectorioFotos } from "./config/runtime.ts";
import { loggerOptions } from "./logging.ts";
import { myPool } from "./db/pool.ts";

const runtime = cargarConfiguracionRuntime();
await prepararDirectorioFotos(runtime);

const server: FastifyInstance = fastify({
  logger: loggerOptions(runtime.logLevel),
  disableRequestLogging: true,
  requestIdHeader: runtime.production ? "x-request-id" : false,
  // Rechazar trabajo nuevo y cerrar conexiones idle sin cortar requests activas.
  return503OnClosing: true,
  forceCloseConnections: "idle",
  // La API no publica puertos; el único salto confiable es el proxy de la red edge.
  trustProxy: runtime.trustProxy,
}).withTypeProvider<TypeBoxTypeProvider>();

const ListeningOptions: FastifyListenOptions = {
  host: "::",
  port: runtime.apiPort,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

await server.register(autoLoad, {
  dir: join(__dirname, "plugins"),
});

await server.register(autoLoad, {
  dir: join(__dirname, "routes"),
});

/*await server.register(fastifyStatic, {
  root: join(resolve(rootDir, ".."), "static"),
  prefix: "/",
});*/


server.get("/", async function (request, reply) {
  return { root: "trueada" };
});

try {
  await server.listen(ListeningOptions);
  server.log.info({ event:"app_started", app_version:runtime.appVersion, git_sha:runtime.gitSha }, "API iniciada");
} catch (err) {
  server.log.error(err);
  process.exit(1);
}

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  server.log.info({ signal }, "Cierre controlado de API");
  try {
    await server.close();
    await myPool.end();
    process.exitCode = 0;
  } catch (error) {
    server.log.error({ err: error }, "FallÃ³ el cierre controlado");
    process.exitCode = 1;
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
