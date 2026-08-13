import fastifyPlugin from "fastify-plugin";
import * as err from "../models/errors.ts";
import { cargarConfiguracionRuntime } from "../config/runtime.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function origenPublicoValido(
  production: boolean,
  publicOrigin: string | undefined,
  method: string,
  origin: unknown,
  upgrade: unknown,
): boolean {
  if (!production) return true;
  const websocket = typeof upgrade === "string" && upgrade.toLowerCase() === "websocket";
  const requiereOrigin = !SAFE_METHODS.has(method.toUpperCase()) || websocket;
  if (origin === undefined) return !requiereOrigin;
  return typeof origin === "string" && origin === publicOrigin;
}

export default fastifyPlugin(async function (fastify) {
  const runtime = cargarConfiguracionRuntime();
  fastify.addHook("onRequest", async function (req) {
    if (!origenPublicoValido(
      runtime.production,
      runtime.publicOrigin,
      req.method,
      req.headers.origin,
      req.headers.upgrade,
    )) throw new err.T05CsrfInvalido();
  });
});
