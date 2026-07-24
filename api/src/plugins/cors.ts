import fastifyPlugin from "fastify-plugin";
import fastifyCors from "@fastify/cors";

export default fastifyPlugin(async function (fastify) {
  fastify.register(fastifyCors, {
    origin: ["http://localhost:4200", "https://localhost:4200", "https://localhost"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
});
