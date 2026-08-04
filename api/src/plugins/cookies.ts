import fastifyCookie from "@fastify/cookie";
import fastifyPlugin from "fastify-plugin";

export const SESSION_COOKIE = "rsp_session";
export const CSRF_COOKIE = "rsp_csrf";
export const SESSION_MAX_AGE_SECONDS = 10 * 60 * 60;

export function cookieOptions(httpOnly: boolean) {
  return {
    path: "/",
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export default fastifyPlugin(async function (fastify) {
  await fastify.register(fastifyCookie);
});
