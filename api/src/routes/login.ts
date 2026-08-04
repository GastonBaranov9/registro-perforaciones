import type { FastifyInstance } from "fastify";
import { Type } from "@fastify/type-provider-typebox";
import {
  UsuarioLogin,
  UsuarioPublico,
  type UsuarioLogin as UsuarioLoginData,
} from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { logUser } from "../services/auth-services.ts";
import { getUsuarioById } from "../services/usuarios-service.ts";
import { getRoles } from "../services/roles-services.ts";
import { randomBytes } from "node:crypto";
import {
  cookieOptions,
  CSRF_COOKIE,
  SESSION_COOKIE,
} from "../plugins/cookies.ts";

const authRoutes = async function (fastify: FastifyInstance) {
  fastify.post(
    "/login",
    {
      schema: {
        summary: "Inicio de sesión de un usuario",
        description: "Rol: Cualquiera",
        tags: ["login"],
        body: UsuarioLogin,
        response: {
          200: Type.Object({
            authenticated: Type.Literal(true),
          }),
            400: err.ErrorSchema,
            401: err.ErrorSchema,
        },
      },
    },
    async function (req, rep) {
      const { email, password } = req.body as UsuarioLoginData;

      const user = await logUser(email, password);
      const roles = await getRoles(user.id_usuario);

      if (!roles) {
        throw new err.T05RolNoEncontrado();
      }

      const token = fastify.jwt.sign(
        {
          sub: user.id_usuario,
          roles,
          version_sesion: user.version_sesion,
        },
        {
          expiresIn: "10h",
        }
      );

      const csrfToken = randomBytes(32).toString("hex");
      rep.setCookie(SESSION_COOKIE, token, cookieOptions(true));
      rep.setCookie(CSRF_COOKIE, csrfToken, cookieOptions(false));

      return { authenticated: true as const };
    }
  );

  fastify.post(
    "/logout",
    {
      schema: {
        summary: "Cierre de sesiÃ³n",
        tags: ["login"],
        response: { 204: Type.Null() },
      },
      onRequest: [fastify.authenticate],
    },
    async function (_req, rep) {
      rep.clearCookie(SESSION_COOKIE, { path: "/" });
      rep.clearCookie(CSRF_COOKIE, { path: "/" });
      return rep.code(204).send();
    }
  );

  fastify.get(
    "/login",
    {
      schema: {
        tags: ["login"],
        response: {
          200: UsuarioPublico,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
    },
    async function (req) {
      const user = await getUsuarioById(req.user.sub);

      if (!user) {
        throw new err.T05UsuarioNoEncontrado();
      }

      return user;
    }
  );
};

export default authRoutes;
