import fp from "fastify-plugin";

export default fp(async function errorHandler(fastify) {
  fastify.setErrorHandler((error, req, rep) => {
    const statusCode = typeof error.statusCode === "number" && error.statusCode >= 400
      ? error.statusCode
      : 500;
    const route = req.routeOptions?.url ?? "unmatched";

    if (statusCode >= 500) {
      req.log.error({ err: error, event: "request_error", request_id: req.id, route }, "Error interno de API");
      return rep.code(statusCode).send({
        statusCode,
        error: statusCode === 503 ? "Service Unavailable" : "Internal Server Error",
        message: statusCode === 503 ? "Servicio temporalmente no disponible" : "Error interno del servidor",
      });
    }

    return rep.code(statusCode).send({
      statusCode,
      error: error.name || "Error",
      message: error.message,
      ...(typeof (error as { code?: unknown }).code === "string" ? { code: (error as { code: string }).code } : {}),
    });
  });
});
