import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import * as err from "../models/errors.ts";
import { Type } from "@fastify/type-provider-typebox";
import {
  Informe,
  CaracteristicasConstructivas,
  IntervaloLitologico,
} from "../models/schemas.ts";
import * as func from "../services/informes-services.ts";
import { listIntervalosLitologicosByPozo } from "../services/intervalos-litologicos-services.ts";
import { getReportePozo } from "../services/generar-informe-consultas.ts";
import { generarPDFBytes } from "../pdf/pdf-generate.ts";
import { Buffer } from "buffer";

const informeRoutes = async function (
  fastify:FastifyInstance
) {
  //Ver un informe
  fastify.get(
    "/usuarios/:id_usuario/pozos/:id_pozo/informes",
    {
      schema: {
        summary: "Ver el informee",
        description: "Rol: Administrador/Perforador",
        tags: ["informes"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
        }),
        response: {
          200: Informe,
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async function (req, rep) {
      const { id_pozo } = req.params as {
        id_pozo: number;
      };
      const informeObtenido = await func.getInforme(id_pozo);
      if (!informeObtenido) throw new err.T05InformeNoEncontrado();
      return rep.code(200).send(informeObtenido);
    }
  );
  fastify.get(
    "/usuarios/:id_usuario/pozos/:id_pozo/caracteristicas",
    {
      schema: {
        summary: "Ver características constructivas",
        description: "Rol: Administrador/Perforador (Solo sus informes)",
        tags: ["informes"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
        }),
        response: {
          200: CaracteristicasConstructivas,
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async function (req, rep) {
      const { id_pozo } = req.params as {
        id_pozo: number;
      };
      const caracteriticasObtenido = await func.getCaracteristicasConstructivas(
        id_pozo
      );
      if (!caracteriticasObtenido) throw new err.T05InformeNoEncontrado();
      return rep.code(200).send(caracteriticasObtenido);
    }
  );

  fastify.get(
    "/usuarios/:id_usuario/pozos/:id_pozo/litologia",
    {
      schema: {
        summary: "Ver características litologicas",
        description: "Rol: Administrador/Perforador (Solo sus informes)",
        tags: ["informes"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
        }),
        response: {
          200: Type.Array(IntervaloLitologico),
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async function (req, rep) {
      const { id_pozo } = req.params as {
        id_pozo: number;
      };
      const caracteriticasObtenido = await listIntervalosLitologicosByPozo(
        id_pozo
      );
      if (!caracteriticasObtenido) throw new err.T05InformeNoEncontrado();
      return rep.code(200).send(caracteriticasObtenido);
    }
  );
  fastify.get(
    "/usuarios/:id_usuario/pozos/:id_pozo/informe-pdf",
    {
      schema: {
        summary: "Descargar informe PDF del pozo",
        description: "Rol: Administrador/Perforador (Solo sus informes)",
        tags: ["informes"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
        }),
        response: {
          200: Type.String({ format: "binary" }),
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async function (req, rep) {
      try {
        const { id_pozo } = req.params as {
          id_usuario: number;
          id_pozo: number;
        };

        const reporte = await getReportePozo(id_pozo);
        if (!reporte) throw new err.T05InformeNoEncontrado();

        const pdfBytes = await generarPDFBytes(reporte, id_pozo);

        return rep
          .header("Content-Type", "application/pdf")
          .header(
            "Content-Disposition",
            `attachment; filename="informe_pozo_${id_pozo}.pdf"`
          )
          .send(Buffer.from(pdfBytes));
      } catch (e) {
        console.error("ERROR GENERANDO PDF:", e);
        throw e;
      }
    }
  );
};

export default informeRoutes;
