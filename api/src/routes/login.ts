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
            token: Type.String(),
          }),
            400: err.ErrorSchema,
            401: err.ErrorSchema,
        },
      },
    },
    async function (req) {
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

      return { token };
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
