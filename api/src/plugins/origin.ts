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
  runtime: Pick<
    RuntimeConfig,
    "production" | "publicOrigin" | "corsOrigins" | "nativeCorsOrigins"
  > = cargarConfiguracionRuntime(),
):Promise<void>{
  fastify.addHook("onRequest", async function (req) {
    const websocket = typeof req.headers.upgrade === "string" &&
      req.headers.upgrade.toLowerCase() === "websocket";
    if (websocket) {
      if (!origenPublicoValido(
        runtime.production,
        runtime.publicOrigin,
        runtime.corsOrigins,
        req.method,
        req.headers.origin,
        req.headers.upgrade,
      )) throw new err.T05CsrfInvalido();
      return;
    }

    if (!runtime.production) return;
    const path = req.url.split("?")[0];
    const origin = req.headers.origin;
    const nativeRequest =
      path.startsWith("/auth/native/") ||
      req.headers.authorization !== undefined ||
      (req.method === "OPTIONS" &&
        typeof origin === "string" &&
        runtime.nativeCorsOrigins.includes(origin));
    if (nativeRequest) {
      if (
        origin !== undefined &&
        (typeof origin !== "string" || !runtime.nativeCorsOrigins.includes(origin))
      ) throw new err.T05CsrfInvalido();
      return;
    }

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

interface OriginPluginOptions {
  runtime?: Pick<
    RuntimeConfig,
    "production" | "publicOrigin" | "corsOrigins" | "nativeCorsOrigins"
  >;
}

export default fastifyPlugin(async function originPlugin(fastify, options: OriginPluginOptions) {
  await registrarValidacionOrigin(fastify, options.runtime ?? cargarConfiguracionRuntime());
});
