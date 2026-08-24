import fastifyPlugin from "fastify-plugin";
import fastifyCors from "@fastify/cors";
import { cargarConfiguracionRuntime } from "../config/runtime.ts";

export default fastifyPlugin(async function (fastify) {
  const { corsOrigins } = cargarConfiguracionRuntime();
  fastify.register(fastifyCors, {
    origin: corsOrigins.length ? corsOrigins : false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
    credentials: true,
  });
});
