import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { Usuario, Rol, UsuarioBody } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import * as func from "../services/usuarios-service.ts";
import * as rolfunc from "../services/roles-services.ts";
import { clientConnections } from "../plugins/websocket.ts";

const usuariosRoutes = async function (
  fastify: FastifyInstance,
  options: object
) {
  //dar de alta un usuario
  fastify.post(
    "/usuarios",
    {
      schema: {
        summary: "Dar de alta un usuario",
        description: "Rol: Administrador",
        tags: ["usuarios"],
        body: UsuarioBody,
        response: {
          201: Usuario,
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdmin],
    },
    async function (req, rep) {
      const data = req.body as UsuarioBody;
      const usuarioNuevo = await func.createUsuario(data);
      return rep.code(201).send(usuarioNuevo);
    }
  );

  //Editar un usuario
  fastify.put(
    "/usuarios/:id_usuario",
    {
      schema: {
        summary: "Editar un usuario",
        description: "Rol: Administrador",
        tags: ["usuarios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
        }),
        body: UsuarioBody,
        response: {
          200: Usuario,
          501: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.IsThisUser],
    },
    async function (req, rep) {
      const { id_usuario } = req.params as {
        id_usuario: number;
      };
    
      const loggedUser = req.user;
        console.log(loggedUser)

      let esAdmin = false;
      if (loggedUser.roles) {
        for (const rol of loggedUser.roles) {
          if (rol.nombre === "administracion") {
            esAdmin = true;
            break;
          }
        }
      }

      const data = req.body as UsuarioBody;

      const usuarioEditado = await func.updateUsuario(
        {
          ...data,
          roles: esAdmin ? data.roles :[],
        },
        id_usuario
      );
      if (!usuarioEditado) throw new err.T05UsuarioNoEncontrado();
      

      const msg = {type: "El usuario ha sido editado"}

      fastify.notifyClient(id_usuario, msg)
      fastify.notifyAdmin(msg)

      return rep.code(200).send(usuarioEditado);


    }
  );

  //Borrar un usuario waefaf
  fastify.delete(
    "/usuarios/:id_usuario",
    {
      schema: {
        summary: "Borrar un usuario",
        description: "Rol: Administrador",
        tags: ["usuarios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
        }),
        response: {
          204: Type.Null(),
          501: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdmin],
    },
    async function (req, rep) {
      const { id_usuario } = req.params as {
        id_usuario: number;
      };
      const usuarioBorrado = await func.deleteUsuario(id_usuario);
      if (!usuarioBorrado) throw new err.T05UsuarioNoEncontrado();
      return rep.code(204).send();
    }
  );
  //Obtener un usuario
  fastify.get(
    "/usuarios/:id_usuario",
    {
      schema: {
        summary: "Obtener un usuario",
        description: "Rol: Administrador",
        tags: ["usuarios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
        }),
        response: {
          200: Usuario,
          501: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.IsThisUser],
    },
    async function (req, rep) {
      const { id_usuario } = req.params as {
        id_usuario: number;
      };
      const usuarioObtenido = await func.getUsuarioById(id_usuario);
      if (!usuarioObtenido) throw new err.T05UsuarioNoEncontrado();
      return rep.code(200).send(usuarioObtenido);
    }
  );
  //Obtener  la lista de usuarios
  fastify.get(
    "/usuarios",
    {
      schema: {
        summary: "Obtener la lista de usuarios un usuario",
        description: "Rol: Administrador",
        tags: ["usuarios"],
        response: {
          200: Type.Array(Usuario),
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdmin],
    },
    async function (req, rep) {
      const listaUsuarios = await func.getAllUsuarios();
      rep.code(200).send(listaUsuarios);
    }
  );

  //Poner o quitar el rol a un usuario
  fastify.put(
    "/usuarios/:id_usuario/roles/:id_rol",
    {
      schema: {
        summary: "Quitar un rol a un usuario",
        description: "Rol: Administrador",
        tags: ["usuarios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
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
      const { id_usuario, id_rol } = req.params as {
        id_usuario: number;
        id_rol: number;
      };
      rolfunc.changeRol(id_usuario, id_rol);
      return rep.code(204).send();
    }
  );

  //Obtener  la lista de roles de un usuario en específico
  fastify.get(
    "/usuarios/:id_usuario/roles",
    {
      schema: {
        summary: "Obtener los roles de un usuario",
        description: "Rol: Administrador o el mismo usuario",
        tags: ["usuarios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
        }),
        response: {
          200: Type.Array(Rol),
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.IsThisUser, fastify.userIsAdmin],
    },
    async function (req, rep) {
      const { id_usuario } = req.params as {
        id_usuario: number;
      };
      const roles = await rolfunc.getRoles(id_usuario);
      return rep.code(200).send(roles);
    }
  );
};
export default usuariosRoutes;
