import fastifyMultipart from "@fastify/multipart";
import fastifyPlugin from "fastify-plugin";
import { MAX_FOTO_BYTES } from "../constants/fotos.ts";

export default fastifyPlugin(async function (fastify) {
  fastify.register(fastifyMultipart, {
    limits: {
      fileSize: MAX_FOTO_BYTES,
      files: 1,
      parts: 10,
    },
  });
});
