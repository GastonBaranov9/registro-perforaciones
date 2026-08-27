import fp from "fastify-plugin";
import { cargarConfiguracionRuntime } from "../config/runtime.ts";
import {
  crearNativeAuthJanitor,
  registrarNativeAuthJanitor,
} from "../services/native-auth-janitor.ts";

export default fp(async function nativeAuthJanitorPlugin(fastify) {
  const janitor = crearNativeAuthJanitor(
    cargarConfiguracionRuntime(),
    fastify.log,
  );
  registrarNativeAuthJanitor(janitor);

  fastify.addHook("onReady", async () => {
    await janitor.start();
  });
  fastify.addHook("onClose", async () => {
    janitor.stop();
    registrarNativeAuthJanitor(null);
  });
});
