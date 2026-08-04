import fastify from "fastify";
import type { FastifyInstance, FastifyListenOptions } from "fastify";
import autoLoad from "@fastify/autoload";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
const server: FastifyInstance = fastify({
  logger: true,
}).withTypeProvider<TypeBoxTypeProvider>();

const ListeningOptions: FastifyListenOptions = {
  host: "::",
  port: 3000,
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
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
