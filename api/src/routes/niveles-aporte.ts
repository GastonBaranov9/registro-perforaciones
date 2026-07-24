import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { Pozo, NivelAporte, Usuario } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { NivelAporteBody } from "../models/schemas.ts";
import * as func from "../services/niveles-aporte-services.ts";

const nivelesAporteRoutes = async function (
  fastify: FastifyInstance,
  options: object
) {
  //Crear un intervalo para niveles de aporte
  fastify.post(
    "/usuarios/:id_usuario/pozos/:id_pozo/niveles_aporte",
    {
      schema: {
        summary: "Crear un intervalo de niveles de aporte de un pozo",
        description: "Rol: Administrador/Perforador",
        tags: ["niveles-aporte"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
        }),

        body: NivelAporteBody,
        response: {
          201: NivelAporte,
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async function (req, rep) {
      try {
        const { id_pozo } = req.params as {
          id_pozo: number;
        };
        const data = req.body as NivelAporteBody;
        const nuevoNivelAporte = await func.createNivelAporte(id_pozo, data);
        if (!nuevoNivelAporte) throw new err.T05PozoNoEncontrado();
        return rep.code(201).send(nuevoNivelAporte);
      } catch (e) {
        req.log.error(e);
      }
    }
  );

  //Editar un intervalo de niveles de aporte
  fastify.put(
    "/usuarios/:id_usuario/pozos/:id_pozo/niveles_aporte/:id_nivel_aporte",
    {
      schema: {
        summary: "Editar un intervalo de niveles de aporte",
        description: "Rol: Administrador/Perforador",
        tags: ["niveles-aporte"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
          id_nivel_aporte: Type.Integer(),
        }),

        body: NivelAporteBody,
        response: {
          200: NivelAporte,
          501: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async function (req, rep) {
      try {
        const { id_pozo, id_nivel_aporte } = req.params as {
          id_pozo: number;
          id_nivel_aporte: number;
        };
        const data = req.body as NivelAporteBody;
        const pozoEditado = await func.updateNivelAporte(
          id_pozo,
          id_nivel_aporte,
          data
        );
        if (!pozoEditado) throw new err.T05PozoNoEncontrado();
        return rep.code(200).send(pozoEditado);
      } catch (e) {
        req.log.error(e);
      }
    }
  );

  //Borrar un intervalo de niveles de aporte
  fastify.delete(
    "/usuarios/:id_usuario/pozos/:id_pozo/niveles_aporte/:id_nivel_aporte",
    {
      schema: {
        summary: "Borrar un intervalo de niveles de aporte",
        description: "Rol: Administrador/Perforador",
        tags: ["niveles-aporte"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
          id_nivel_aporte: Type.Integer(),
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
      try {
        const { id_pozo, id_nivel_aporte } = req.params as {
          id_pozo: number;
          id_nivel_aporte: number;
        };
        const nivelAporteBorrado = await func.deleteNivelAporte(
          id_pozo,
          id_nivel_aporte
        );
        if (!nivelAporteBorrado) throw new err.T05PozoNoEncontrado();
        return rep.code(204).send(null);
      } catch (e) {
        req.log.error(e);
      }
    }
  );
  //Obtener un intervalo de niveles de aporte
  fastify.get(
    "/usuarios/:id_usuario/pozos/:id_pozo/niveles_aporte/:id_nivel_aporte",
    {
      schema: {
        summary: "Obtener un intervalo de niveles de aporte",
        description: "Rol: Administrador/Perforador",
        tags: ["niveles-aporte"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
          id_nivel_aporte: Type.Integer(),
        }),

        response: {
          200: NivelAporte,
          501: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async function (req, rep) {
      try {
        const { id_pozo, id_nivel_aporte } = req.params as {
          id_pozo: number;
          id_nivel_aporte: number;
        };
        const nivelAporte = await func.getNivelAporteById(
          id_pozo,
          id_nivel_aporte
        );
        if (!nivelAporte) throw new err.T05PozoNoEncontrado();
        return rep.code(200).send(nivelAporte);
      } catch (e) {
        rep.log.error(e);
      }
    }
  );
  fastify.get(
    "/usuarios/:id_usuario/pozos/:id_pozo/niveles_aporte",
    {
      schema: {
        summary: "Listar niveles de aporte de un pozo",
        description: "Rol: Administrador/Perforador",
        tags: ["niveles-aporte"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
        }),
        response: {
          200: Type.Array(NivelAporte),
          500: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async (req, rep) => {
      try {
        const { id_pozo } = req.params as {
          id_usuario: number;
          id_pozo: number;
        };
        const listaAporte = await func.getNivelAporteList(
          id_pozo
        );
        return rep.code(200).send(listaAporte);
      } catch (e: any) {
        req.log.error(e);
        if (e?.statusCode) throw e;
        throw new err.T05ErrorDesconocido();
      }
    }
  );
};
export default nivelesAporteRoutes;
