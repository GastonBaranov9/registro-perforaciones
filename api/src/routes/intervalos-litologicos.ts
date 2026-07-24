import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import {
  bodyIntervaloLitologico,
  IntervaloLitologico,
  Pozo,
  Usuario,
} from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import * as func from "../services/intervalos-litologicos-services.ts";

const intervalosLitologicosRoutes = async function (
  fastify: FastifyInstance,
  options: object
) {
  //Crear un intervalo litologico para un pozo
  fastify.post(
    "/usuarios/:id_usuario/pozos/:id_pozo/intervalo_litologico",
    {
      schema: {
        summary: "Crear un intervalo litologico de un pozo",
        description: "Rol: Administrador/Perforador",
        tags: ["intervalos-litologicos"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
        }),
        body: bodyIntervaloLitologico,
        response: {
          201: IntervaloLitologico,
          400: err.ErrorSchema,
          404: err.ErrorSchema,
          500: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async (req, rep) => {
      try {
        const { id_pozo } = req.params as {
          id_usuario: number;
          id_pozo: number;
        };
        const creado = await func.createIntervaloLitologico(
          id_pozo,
          req.body as any
        );
        return rep.code(201).send(creado);
      } catch (e: any) {
        req.log.error(e);
        if (e?.statusCode) throw e;
        throw new err.T05ErrorDesconocido();
      }
    }
  );

  //Editar la intervalo litologico de un pozo
  fastify.put(
    "/usuarios/:id_usuario/pozos/:id_pozo/intervalo_litologico/:id_intervalo_litologico",
    {
      schema: {
        summary: "Editar una intervalo litologico",
        description: "Rol: Administrador/Perforador",
        tags: ["intervalos-litologicos"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
          id_intervalo_litologico: Type.Integer(),
        }),
        body: bodyIntervaloLitologico,
        response: {
          200: IntervaloLitologico,
          500: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async (req, rep) => {
      try {
        const { id_pozo, id_intervalo_litologico } = req.params as {
          id_usuario: number;
          id_pozo: number;
          id_intervalo_litologico: number;
        };
        const editar = await func.updateIntervaloLitologico(
          id_pozo,
          id_intervalo_litologico,
          req.body as any
        );
        if (!editar) {
          throw new err.T05RegistroNoEncontrado(
            "Intervalo litológico no encontrado"
          );
        }
        return rep.code(200).send(editar);
      } catch (e: any) {
        req.log.error(e);
        if (e?.statusCode) throw e;
        throw new err.T05ErrorDesconocido();
      }
    }
  );

  //Borrar una intervalo_litologico
  fastify.delete(
    "/usuarios/:id_usuario/pozos/:id_pozo/intervalo_litologico/:id_intervalo_litologico",
    {
      schema: {
        summary: "Borrar un intervalo litologico",
        description: "Rol: Administrador/Perforador",
        tags: ["intervalos-litologicos"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
          id_intervalo_litologico: Type.Integer(),
        }),
        response: {
          204: Type.Null(),
          500: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async (req, rep) => {
      try {
        const { id_pozo, id_intervalo_litologico } = req.params as {
          id_usuario: number;
          id_pozo: number;
          id_intervalo_litologico: number;
        };
        const borrado = await func.deleteIntervaloLitologico(
          id_pozo,
          id_intervalo_litologico
        );
        if (!borrado) {
          throw new err.T05RegistroNoEncontrado(
            "Intervalo litológico no encontrado"
          );
        }
        return rep.code(204).send(null);
      } catch (e: any) {
        req.log.error(e);
        if (e?.statusCode) throw e;
        throw new err.T05ErrorDesconocido();
      }
    }
  );
  //Obtener un intervalo litologico
  fastify.get(
    "/usuarios/:id_usuario/pozos/:id_pozo/intervalo_litologico/:id_intervalo_litologico",
    {
      schema: {
        summary: "Obtener un intervalo litologicos",
        description: "Rol: Administrador/Perforador",
        tags: ["intervalos-litologicos"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
          id_intervalo_litologico: Type.Integer(),
        }),
        response: {
          200: IntervaloLitologico,
          500: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async (req, rep) => {
      try {
        const { id_pozo, id_intervalo_litologico } = req.params as {
          id_usuario: number;
          id_pozo: number;
          id_intervalo_litologico: number;
        };
        const obtener = await func.getIntervaloLitologicoById(
          id_pozo,
          id_intervalo_litologico
        );
        if (!obtener)
          throw new err.T05RegistroNoEncontrado(
            "Intervalo litológico no encontrado"
          );
        return rep.code(200).send(obtener);
      } catch (e: any) {
        req.log.error(e);
        if (e?.statusCode) throw e;
        throw new err.T05ErrorDesconocido();
      }
    }
  );
  fastify.get(
    "/usuarios/:id_usuario/pozos/:id_pozo/intervalo_litologico",
    {
      schema: {
        summary: "Listar intervalos litológicos de un pozo",
        description: "Rol: Administrador/Perforador",
        tags: ["intervalos-litologicos"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
        }),
        response: {
          200: Type.Array(IntervaloLitologico),
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
        const listaIntervalos = await func.listIntervalosLitologicosByPozo(
          id_pozo
        );
        return rep.code(200).send(listaIntervalos);
      } catch (e: any) {
        req.log.error(e);
        if (e?.statusCode) throw e;
        throw new err.T05ErrorDesconocido();
      }
    }
  );
};

export default intervalosLitologicosRoutes;
