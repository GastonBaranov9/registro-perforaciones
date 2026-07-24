import type { FastifyInstance } from "fastify";
import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Rol, RolBody } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import * as func from "../services/roles-services.ts";
const rolesRoutes = async function (
  fastify: FastifyInstance,
  options: object
) {
  //Crear un rol
  fastify.post(
    "/roles",
    {
      schema: {
        summary: "Crear un rol",
        description: "Rol: Administrador",
        tags: ["roles"],
        body: RolBody,
        response: {
          201: Rol,
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdmin],
    },
    async function (req, rep) {
      const data = req.body as RolBody;
      const nuevoRol = await func.createRol(data);
      rep.code(201).send(nuevoRol);
    }
  );

  //Editar un rol
  fastify.put(
    "/roles/:id_rol",
    {
      schema: {
        summary: "Editar un rol",
        description: "Rol: Administrador",
        tags: ["roles"],
        params: Type.Object({
          id_rol: Type.Integer(),
        }),
        body: RolBody,
        response: {
          200: Rol,
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdmin],
    },
    async function (req, rep) {
      const { id_rol } = req.params as {
        id_rol: number;
      };
      const data = req.body as RolBody;
      const rolEditado = await func.updateRol(data, id_rol);
      if (!rolEditado) throw new err.T05RolNoEncontrado();
      return rep.code(200).send(rolEditado);
    }
  );

  //Borrar un rol
  fastify.delete(
    "/roles/:id_rol",
    {
      schema: {
        summary: "Borrar un rol",
        description: "Rol: Administrador",
        tags: ["roles"],
        params: Type.Object({
          id_rol: Type.Integer(),
        }),
        response: {
          204: Type.Null(),
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdmin],
    },
    async function (req, rep) {
      const { id_rol } = req.params as {
        id_rol: number;
      };
      const rolBorrado = await func.deleteRol(id_rol);
      if (!rolBorrado) throw new err.T05RolNoEncontrado();
      return rep.code(204).send();
    }
  );

  //Obtener un rol específico
  fastify.get(
    "/roles/:id_rol",
    {
      schema: {
        summary: "Obtener un rol",
        description: "Rol: Administrador",
        tags: ["roles"],
        params: Type.Object({
          id_rol: Type.Integer(),
        }),
        response: {
          200: Rol,
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdmin],
    },
    async function (req, rep) {
            const { id_rol } = req.params as {
        id_rol: number;
      };
      const rolObtenido = await func.getRolById(id_rol);
      if (!rolObtenido) throw new err.T05RolNoEncontrado();
      return rep.code(200).send(rolObtenido);
    }
  );
  //Obtener  la lista de roles
  fastify.get(
    "/roles",
    {
      schema: {
        summary: "Obtener todos los roles",
        description: "Rol: Administrador",
        tags: ["roles"],
        response: {
          200: Type.Array(Rol),
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdmin],
    },
    async function (req, rep) {
      const listaRoles = await func.getAllRoles()
      rep.code(200).send(listaRoles)
    }
  );
};
export default rolesRoutes;
