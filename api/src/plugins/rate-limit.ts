import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { cargarConfiguracionRuntime } from "../config/runtime.ts";
import { MemoryRateLimiter } from "../services/rate-limit-service.ts";

type Limite = "api" | "login" | "maps" | "pdf" | "upload";

export default fp(async function rateLimits(fastify) {
  const config = cargarConfiguracionRuntime();
  const limiters: Record<Limite, MemoryRateLimiter> = {
    api: new MemoryRateLimiter(config.rateLimits.api, 60_000),
    login: new MemoryRateLimiter(config.rateLimits.login, 60_000),
    maps: new MemoryRateLimiter(config.rateLimits.maps, 60_000),
    pdf: new MemoryRateLimiter(config.rateLimits.pdf, 300_000),
    upload: new MemoryRateLimiter(config.rateLimits.upload, 300_000),
  };

  fastify.addHook("onRequest", async (req, rep) => {
    const route = req.routeOptions?.url;
    if (route === "/health" || route === "/ready" || route === "/ws") return;
    const result = limiters.api.consume(`api:ip:${req.ip}`);
    if (result.allowed) return;
    req.log.warn({ event: "rate_limit_rejected", area: "api" }, "Solicitud limitada");
    return rep.header("Retry-After", String(result.retryAfterSeconds)).code(429).send({
      statusCode: 429, error: "Too Many Requests", message: "Demasiadas solicitudes. Intente nuevamente mÃ¡s tarde.",
    });
  });

  const hook = (area: Limite, authenticated: boolean) => async (req: FastifyRequest, rep: FastifyReply) => {
    const user = authenticated && req.user?.sub ? `u:${req.user.sub}` : "anon";
    const result = limiters[area].consume(`${area}:${user}:ip:${req.ip}`);
    if (result.allowed) return;
    req.log.warn({ event: "rate_limit_rejected", area }, "Solicitud limitada");
    return rep
      .header("Retry-After", String(result.retryAfterSeconds))
      .code(429)
      .send({ statusCode: 429, error: "Too Many Requests", message: "Demasiadas solicitudes. Intente nuevamente mÃ¡s tarde." });
  };

  fastify.decorate("rateLimitLogin", hook("login", false));
  fastify.decorate("rateLimitMaps", hook("maps", true));
  fastify.decorate("rateLimitPdf", hook("pdf", true));
  fastify.decorate("rateLimitUpload", hook("upload", true));
});

declare module "fastify" {
  interface FastifyInstance {
    rateLimitLogin: (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>;
    rateLimitMaps: (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>;
    rateLimitPdf: (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>;
    rateLimitUpload: (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>;
  }
}
