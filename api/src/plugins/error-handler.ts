import fp from "fastify-plugin";

export default fp(async function errorHandler(fastify) {
  fastify.setErrorHandler((error, req, rep) => {
    const httpError = typeof error === "object" && error !== null
      ? error as { statusCode?: unknown; name?: unknown; message?: unknown; code?: unknown }
      : {};
    const statusCode = typeof httpError.statusCode === "number" && httpError.statusCode >= 400
      ? httpError.statusCode
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
      error: typeof httpError.name === "string" && httpError.name ? httpError.name : "Error",
      message: typeof httpError.message === "string" ? httpError.message : "Solicitud inválida",
      ...(typeof httpError.code === "string" ? { code: httpError.code } : {}),
    });
  });
});
