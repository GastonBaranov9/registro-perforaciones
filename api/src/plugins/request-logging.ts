import fp from "fastify-plugin";

export default fp(async function requestLogging(fastify) {
  const starts = new WeakMap<object, bigint>();
  fastify.addHook("onRequest", async (req, rep) => {
    starts.set(req, process.hrtime.bigint());
    rep.header("X-Request-Id", req.id);
  });
  fastify.addHook("onSend", async (req, rep) => {
    const route = req.routeOptions?.url;
    if (route !== "/health" && route !== "/ready" && !rep.hasHeader("Cache-Control"))
      rep.header("Cache-Control", "private, no-store");
  });
  fastify.addHook("onResponse", async (req, rep) => {
    const start = starts.get(req) ?? process.hrtime.bigint();
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    req.log.info({
      event: "request_completed",
      request_id: req.id,
      method: req.method,
      route: req.routeOptions?.url ?? "unmatched",
      status: rep.statusCode,
      duration_ms: Number(durationMs.toFixed(2)),
    }, "Solicitud completada");
  });
});
