import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import {
  IntervaloDiametroPerforacion,
  Pozo,
  Usuario,
  IntervaloDiametroPerforacionBody,
} from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import * as func from "../services/intervalo-diametro-services.ts";

const intervalosDiametroPerforacionRoutes =
  async function (fastify: FastifyInstance, _options: object) {
    // Crear un intervalo de diámetro para un pozo
    fastify.post(
      "/usuarios/:id_usuario/pozos/:id_pozo/intervalo_diametro_perforacion",
      {
        schema: {
          summary: "Crear un intervalo de diámetro de un pozo",
          description: "Rol: Administrador/Perforador",
          params: Type.Object({
            id_usuario: Type.Integer(),
            id_pozo: Type.Integer(),
          }),
          tags: ["intervalos-diametro-perforaciones"],
          body: IntervaloDiametroPerforacionBody,
          response: {
            201: IntervaloDiametroPerforacion,
            400: err.ErrorSchema,
            404: err.ErrorSchema,
            500: err.ErrorSchema,
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
            id_usuario: number;
            id_pozo: number;
          };
          const creado = await func.createIntervaloDiametro(
            id_pozo,
            req.body as any
          );
          rep.code(201).send(creado);
        } catch (e: any) {
          req.log.error(e);
          if (e?.statusCode) throw e;
          throw new err.T05ErrorDesconocido();
        }
      }
    );

    // Editar un intervalo de diámetro de un pozo
    fastify.put(
      "/usuarios/:id_usuario/pozos/:id_pozo/intervalo_diametro_perforacion/:id_intervalo_diametro_perforacion",
      {
        schema: {
          summary: "Editar un intervalo de diámetro",
          description: "Rol: Administrador/Perforador",
          tags: ["intervalos-diametro-perforaciones"],
          params: Type.Object({
            id_usuario: Type.Integer(),
            id_pozo: Type.Integer(),
            id_intervalo_diametro_perforacion: Type.Integer(),
          }),
          body: IntervaloDiametroPerforacionBody,
          response: {
            200: IntervaloDiametroPerforacion,
            400: err.ErrorSchema,
            404: err.ErrorSchema,
            500: err.ErrorSchema,
          },
          security: [{ BearerAuth: [] }],
        },
        onRequest: [fastify.authenticate],
        preHandler: [fastify.userIsAdminOrPerforador],
      },
      async function (req, rep) {
        try {
          const { id_pozo, id_intervalo_diametro_perforacion } = req.params as {
            id_usuario: number;
            id_pozo: number;
            id_intervalo_diametro_perforacion: number;
          };

          const updated = await func.updateIntervaloDiametro(
            id_pozo,
            id_intervalo_diametro_perforacion,
            req.body as any
          );

          if (!updated) {
            throw new err.T05RegistroNoEncontrado(
              "Intervalo no encontrado para este pozo"
            );
          }

          rep.code(200).send(updated);
        } catch (e: any) {
          req.log.error(e);
          if (e?.statusCode) throw e;
          throw new err.T05ErrorDesconocido();
        }
      }
    );

    // Borrar un intervalo de diámetro de un pozo
    fastify.delete(
      "/usuarios/:id_usuario/pozos/:id_pozo/intervalo_diametro_perforacion/:id_intervalo_diametro_perforacion",
      {
        schema: {
          summary: "Borrar un intervalo de diámetro",
          description: "Rol: Administrador/Perforador",
          tags: ["intervalos-diametro-perforaciones"],
          params: Type.Object({
            id_usuario: Type.Integer(),
            id_pozo: Type.Integer(),
            id_intervalo_diametro_perforacion: Type.Integer(),
          }),
          response: {
            204: Type.Null(),
            404: err.ErrorSchema,
            500: err.ErrorSchema,
          },
          security: [{ BearerAuth: [] }],
        },
        onRequest: [fastify.authenticate],
        preHandler: [fastify.userIsAdminOrPerforador],
      },
      async function (req, rep) {
        try {
          const { id_pozo, id_intervalo_diametro_perforacion } = req.params as {
            id_usuario: number;
            id_pozo: number;
            id_intervalo_diametro_perforacion: number;
          };

          const ok = await func.deleteIntervaloDiametro(
            id_pozo,
            id_intervalo_diametro_perforacion
          );
          if (!ok) {
            throw new err.T05RegistroNoEncontrado(
              "Intervalo no encontrado para este pozo"
            );
          }
          rep.code(204).send(null);
        } catch (e: any) {
          req.log.error(e);
          if (e?.statusCode) throw e;
          throw new err.T05ErrorDesconocido();
        }
      }
    );

    // Obtener un intervalo de diámetro
    fastify.get(
      "/usuarios/:id_usuario/pozos/:id_pozo/intervalo_diametro_perforacion/:id_intervalo_diametro_perforacion",
      {
        schema: {
          summary: "Obtener un intervalo de diámetro",
          description: "Rol: Administrador/Perforador",
          tags: ["intervalos-diametro-perforaciones"],
          params: Type.Object({
            id_usuario: Type.Integer(),
            id_pozo: Type.Integer(),
            id_intervalo_diametro_perforacion: Type.Integer(),
          }),
          response: {
            200: IntervaloDiametroPerforacion,
            404: err.ErrorSchema,
            500: err.ErrorSchema,
          },
          security: [{ BearerAuth: [] }],
        },
        onRequest: [fastify.authenticate],
        preHandler: [fastify.userIsPropietarioOrPerforadorOrAdmin],
      },
      async function (req, rep) {
        try {
          const { id_pozo, id_intervalo_diametro_perforacion } = req.params as {
            id_usuario: number;
            id_pozo: number;
            id_intervalo_diametro_perforacion: number;
          };

          const interv = await func.getIntervaloDiametroById(
            id_pozo,
            id_intervalo_diametro_perforacion
          );
          if (!interv) {
            throw new err.T05RegistroNoEncontrado(
              "Intervalo no encontrado para este pozo"
            );
          }
          rep.code(200).send(interv);
        } catch (e: any) {
          req.log.error(e);
          if (e?.statusCode) throw e;
          throw new err.T05ErrorDesconocido();
        }
      }
    );

    // Obtener todos los intervalos de una perforacion
    fastify.get(
      "/usuarios/:id_usuario/pozos/:id_pozo/intervalo_diametro_perforacion",
      {
        schema: {
          summary: "Obtener todos los intervalos de una perforacion",
          description: "Rol: Administrador/Perforador",
          tags: ["intervalos-diametro-perforaciones"],
          params: Type.Object({
            id_usuario: Type.Integer(),
            id_pozo: Type.Integer(),
          }),
          response: {
            200: Type.Array(IntervaloDiametroPerforacion),
            404: err.ErrorSchema,
            500: err.ErrorSchema,
          },
          security: [{ BearerAuth: [] }],
        },
        onRequest: [fastify.authenticate],
        preHandler: [fastify.userIsPropietarioOrPerforadorOrAdmin],
      },
      async function (req, rep) {
        const { id_pozo } = req.params as {
          id_usuario: number;
          id_pozo: number;
        };

        const intervalos = await func.listIntervalosDiametroByPozo(id_pozo);
        return rep.code(200).send(intervalos);
      }
    );
  };

export default intervalosDiametroPerforacionRoutes;
