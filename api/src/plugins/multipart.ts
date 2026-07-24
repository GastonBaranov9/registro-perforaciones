import fastifyMultipart from "@fastify/multipart";
import fastifyPlugin from "fastify-plugin";

export default fastifyPlugin(async function (fastify) {
  fastify.register(fastifyMultipart);
});
