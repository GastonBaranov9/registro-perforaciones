import type { FastifyRequest } from "fastify";

export function sanitizarTextoLog(value: unknown): string {
  return String(value)
    .replace(/([?&](?:key|api_key|token|access_token|ticket|ws_ticket)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/rsp[wn]1_[A-Za-z0-9_-]{43}/g, "[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, "$1[REDACTED]@");
}

export function loggerOptions(level: string) {
  return {
    level,
    redact: {
      paths: [
        "req.headers.authorization", "req.headers.cookie", "req.headers['x-csrf-token']",
        "res.headers['set-cookie']", "password", "*.password", "req.body.password",
        "req.body.foto", "req.body.*.base64", "*.base64", "authorization", "cookie", "csrf",
        "session_token", "*.session_token", "native_token", "*.native_token",
        "ticket", "*.ticket", "ws_ticket", "*.ws_ticket",
      ],
      censor: "[REDACTED]",
    },
    serializers: {
      err(error: Error) {
        return {
          type: error.name,
          message: sanitizarTextoLog(error.message),
          stack: error.stack ? sanitizarTextoLog(error.stack) : undefined,
        };
      },
      req(request: FastifyRequest) {
        return { method: request.method, route: request.routeOptions?.url ?? "unmatched" };
      },
    },
  };
}
