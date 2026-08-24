import type { FastifyInstance } from "fastify";
import { Type } from "@fastify/type-provider-typebox";
import { myPool } from "../db/pool.ts";

export interface ReadinessDb {
  query(config: { text: string; query_timeout: number }): Promise<unknown>;
}

export async function comprobarReadiness(db: ReadinessDb, timeoutMs = 2_000): Promise<boolean> {
  try {
    await db.query({ text: "SELECT 1", query_timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

export function crearRutasHealth(db: ReadinessDb = myPool) {
  return async function healthRoutes(fastify: FastifyInstance) {
    fastify.get(
      "/health",
      {
        schema: {
          tags: ["health"],
          response: { 200: Type.Object({ status: Type.Literal("ok") }) },
        },
      },
      async () => ({ status: "ok" as const }),
    );

    fastify.get(
      "/ready",
      {
        schema: {
          tags: ["health"],
          response: {
            200: Type.Object({ status: Type.Literal("ok") }),
            503: Type.Object({ status: Type.Literal("unavailable") }),
          },
        },
      },
      async (_req, reply) => {
        if (await comprobarReadiness(db)) return { status: "ok" as const };
        return reply.code(503).send({ status: "unavailable" as const });
      },
    );
  };
}

export default crearRutasHealth();
