import fastifyPlugin from "fastify-plugin";
import fastifyCors from "@fastify/cors";
import { cargarConfiguracionRuntime } from "../config/runtime.ts";

export default fastifyPlugin(async function (fastify) {
  const { corsOrigins, nativeCorsOrigins } = cargarConfiguracionRuntime();
  fastify.register(fastifyCors, {
    delegator: async (req) => {
      const origin = req.headers.origin;
      const requestedHeaders = req.headers["access-control-request-headers"];
      const native =
        typeof origin === "string" &&
        nativeCorsOrigins.includes(origin) &&
        (
          req.url.split("?")[0].startsWith("/auth/native/") ||
          req.headers.authorization !== undefined ||
          (typeof requestedHeaders === "string" &&
            /(?:^|,)\s*(?:authorization|x-native-platform|x-native-app-build)\s*(?:,|$)/i.test(requestedHeaders))
        );
      return {
        origin: native
          ? nativeCorsOrigins
          : (corsOrigins.length ? corsOrigins : false),
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: native
          ? [
              "Authorization",
              "Content-Type",
              "X-Native-Platform",
              "X-Native-App-Build",
              "X-Native-App-Version",
            ]
          : ["Content-Type", "X-CSRF-Token"],
        exposedHeaders: native
          ? ["Content-Disposition", "X-Request-Id"]
          : undefined,
        credentials: !native,
      };
    },
  });
});
