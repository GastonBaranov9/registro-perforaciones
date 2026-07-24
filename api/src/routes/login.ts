import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Usuario, UsuarioLogin, UsuarioRegister } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { Type } from "@fastify/type-provider-typebox";
import { logUser } from "../services/auth-services.ts";
  import { getUsuarioById } from "../services/usuarios-service.ts";
import { getRoles } from "../services/roles-services.ts";


const authRoutes = async function (
  fastify: FastifyInstance,
  options: object
) {
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
          501: err.ErrorSchema,
        },
      },
    },
    async function (req, rep) {
      try {
        const { email, password } = req.body as Pick<
          Usuario,
          "email" | "password"
        >;
        const user = await logUser(email, password);
        const roles = await getRoles(user.id_usuario)
        if(!roles) throw new err.T05RolNoEncontrado()
        const token = fastify.jwt.sign(
          { sub: user.id_usuario, roles },
          { expiresIn: "10h" }
        );

        return { token };
      } catch (e) {
        throw e
      }
    }
  );
   fastify.get(
    "/login",
    {
      schema: {
        tags: ["login"],
        response: {
          200: Usuario
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
    },
    async function (req) {
      try {
      const id = req.user.sub; 
      const user = await getUsuarioById(id);

      if (!user) throw new err.T05UsuarioNoEncontrado();

      return user;
    } catch (e) {
      throw new err.T05ErrorConexion();
    }
    }
  );
};
export default authRoutes;
