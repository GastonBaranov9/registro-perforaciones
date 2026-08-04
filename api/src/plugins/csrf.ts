import { timingSafeEqual } from "node:crypto";
import fastifyPlugin from "fastify-plugin";
import * as err from "../models/errors.ts";
import { CSRF_COOKIE, SESSION_COOKIE } from "./cookies.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfValido(cookie: unknown, header: unknown): boolean {
  if (typeof cookie !== "string" || typeof header !== "string") return false;

  const cookieBuffer = Buffer.from(cookie);
  const headerBuffer = Buffer.from(header);
  return (
    cookieBuffer.length > 0 &&
    cookieBuffer.length === headerBuffer.length &&
    timingSafeEqual(cookieBuffer, headerBuffer)
  );
}

export default fastifyPlugin(async function (fastify) {
  fastify.addHook("onRequest", async function (req) {
    if (SAFE_METHODS.has(req.method)) return;
    if (req.method === "POST" && req.url.split("?")[0] === "/login") return;
    if (!req.cookies[SESSION_COOKIE]) return;

    if (!csrfValido(req.cookies[CSRF_COOKIE], req.headers["x-csrf-token"])) {
      throw new err.T05CsrfInvalido();
    }
  });
});
