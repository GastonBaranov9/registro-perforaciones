import fastifyPlugin from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import * as err from "../models/errors.ts";
import { cargarConfiguracionRuntime, type RuntimeConfig } from "../config/runtime.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function origenPublicoValido(
  production: boolean,
  publicOrigin: string | undefined,
  httpOrigins: readonly string[],
  method: string,
  origin: unknown,
  upgrade: unknown,
): boolean {
  if (!production) return true;
  const websocket = typeof upgrade === "string" && upgrade.toLowerCase() === "websocket";
  const requiereOrigin = !SAFE_METHODS.has(method.toUpperCase()) || websocket;
  if (origin === undefined) return !requiereOrigin;
  if (typeof origin !== "string") return false;
  return websocket ? origin === publicOrigin : httpOrigins.includes(origin);
}

export async function registrarValidacionOrigin(
  fastify: FastifyInstance,
  runtime: Pick<RuntimeConfig,"production"|"publicOrigin"|"corsOrigins">=cargarConfiguracionRuntime(),
):Promise<void>{
  fastify.addHook("onRequest", async function (req) {
    if (!origenPublicoValido(
      runtime.production,
      runtime.publicOrigin,
      runtime.corsOrigins,
      req.method,
      req.headers.origin,
      req.headers.upgrade,
    )) throw new err.T05CsrfInvalido();
  });
}

export default fastifyPlugin(registrarValidacionOrigin);
