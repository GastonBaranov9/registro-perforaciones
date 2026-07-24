import fastify from "fastify";
import type { FastifyInstance, FastifyListenOptions } from "fastify";
import autoLoad from "@fastify/autoload";
import { fileURLToPath } from "node:url";
import path, { dirname, join, resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
const server: FastifyInstance = fastify({
  logger: true,
}).withTypeProvider<TypeBoxTypeProvider>();

const ListeningOptions: FastifyListenOptions = {
  host: "::",
  port: 3000,
};

const rootDir = dirname(process.argv[1]);
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

server.register(fastifyStatic, {
  root: path.join(__dirname, "static"),
  prefix: "/",
  decorateReply: false,
});

server.register(fastifyStatic, {
  root: path.join(__dirname, "../public"),
  prefix: "/public/",
});

server.get("/", async function (request, reply) {
  return { root: "trueada" };
});

try {
  await server.listen(ListeningOptions);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
