import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { Usuario, Rol, Sitio } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { SitioBody } from "../models/schemas.ts";
import * as func from '../services/sitios-service.ts'
//intervalo litologico, intervalo de diámetro, revestimiento, cementación, desarrollo y nivel de aporte. Cementacion esta hecho y litologia casi hecho. Anda haciendo alguna otra de esas
//Otra cosa, de esas cosas hay q ver cuales un pozo puede tener 1 o mas. Así vemos si necesitan id o no.

const sitiosRoutes= async function (
  fastify: FastifyInstance,
  options: object
) {
  //Crear un sitio
  fastify.post(
    "/usuarios/:id_usuario/sitios",
    {
      schema: {
        summary: "Crear un sitio",
        description: "Rol: Administrador/Perforador",
        tags: ["sitios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
        }),
        body: SitioBody,
        response: {
          201: Sitio,
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async function (req, rep) {
      const data = req.body as SitioBody
      const nuevoSitio = await func.createSitio(data)
      return rep.code(201).send(nuevoSitio)
    }
  );

  //Editar un sitio
  fastify.put(
    "/usuarios/:id_usuario/sitios/:id_sitio",
    {
      schema: {
        summary: "Editar un sitio",
        description: "Rol: Administrador/Perforador",
        tags: ["sitios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_sitio: Type.Integer(),
        }),
        body: SitioBody,
        response: {
          200: Sitio,
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async function (req, rep) {
      const {id_sitio} = req.params as {
        id_sitio:number
      }
      const data = req.body as SitioBody;
      const sitioEditado = await func.updateSitio(id_sitio, data)
      if(!sitioEditado) throw err.T05SitioNoEncontrado
      return rep.code(200).send(sitioEditado)
    }
  );

  //Borrar un sitio
  fastify.delete(
    "/usuarios/:id_usuario/sitios/:id_sitio",
    {
      schema: {
        summary: "Borrar un sitio",
        description: "Rol: Administrador/Perforador",
        tags: ["sitios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_sitio: Type.Integer(),
        }),
        response: {
          204: Type.Null(),
          501: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async function (req, rep) {
      const {id_sitio} = req.params as {
        id_sitio: number
      }
      const sitioBorrado = await func.deleteSitio(id_sitio)
      if(!sitioBorrado) throw new err.T05SitioNoEncontrado
      return rep.code(204).send()
    }
  );
  //Obtener un sitio
  fastify.get(
    "/usuarios/:id_usuario/sitios/:id_sitio",
    {
      schema: {
        summary: "Obtener un sitio",
        description: "Rol: Administrador/Perforador",
        tags: ["sitios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_sitio: Type.Integer(),
        }),
        response: {
          200: Sitio,
          501: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async function (req, rep) {
      const {id_sitio} = req.params as {
        id_sitio: number
      }
      const sitioObtenido = await func.getSitioById(id_sitio)
      if(!sitioObtenido)throw new err.T05SitioNoEncontrado
      return rep.code(200).send(sitioObtenido)
    }
  );
  //Obtener  la lista de sitios
  fastify.get(
    "/usuarios/:id_usuario/sitios",
    {
      schema: {
        summary: "Obtener la lista de sitios",
        description: "Rol: Administrador/Perforador",
        params: Type.Object({
          id_usuario: Type.Integer(),
        }),
        tags: ["sitios"],
        response: {
          200: Type.Array(Sitio),
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async function (req, rep) {
      const listaSitios = await func.getAllSitios()
      return rep.code(200).send(listaSitios)
    }
  );
};
export default sitiosRoutes;
