import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import * as err from "../models/errors.ts";
import { Type } from "@fastify/type-provider-typebox";
import {
  Informe,
  CaracteristicasConstructivas,
  IntervaloLitologico,
  PerfilLitologicoVistaPreviaBody,
} from "../models/schemas.ts";
import * as func from "../services/informes-services.ts";
import { listIntervalosLitologicosByPozo } from "../services/intervalos-litologicos-services.ts";
import { getReportePozo } from "../services/generar-informe-consultas.ts";
import { generarPDFBytes } from "../pdf/pdf-generate.ts";
import { Buffer } from "buffer";
import { crearPerfilLitologico } from "../pdf/perfil-litologico.ts";
import { validarDatosTecnicosPozo } from "../services/pozo-completo-service.ts";

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
      preHandler: [fastify.pozoIsFromUser, fastify.userIsPropietarioOrPerforadorOrAdmin],
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
      preHandler: [fastify.pozoIsFromUser, fastify.userIsPropietarioOrPerforadorOrAdmin],
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
      preHandler: [fastify.pozoIsFromUser, fastify.userIsPropietarioOrPerforadorOrAdmin],
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
    "/usuarios/:id_usuario/pozos/:id_pozo/perfil-litologico",
    {
      schema: {
        summary: "Obtener el modelo visual del perfil litológico",
        description: "Fuente visual compartida por el informe web y el PDF",
        tags: ["informes"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
        }),
        response: {
          200: Type.Union([Type.Any(), Type.Null()]),
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.pozoIsFromUser, fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async function (req, rep) {
      const { id_pozo } = req.params as { id_pozo: number };
      const reporte = await getReportePozo(id_pozo);
      if (!reporte) throw new err.T05InformeNoEncontrado();
      return rep.code(200).send(
        crearPerfilLitologico(
          reporte.litologia,
          reporte.profundidad_final_m,
          reporte.niveles_aporte,
          reporte.diametros,
          reporte.filtros ?? [],
        ),
      );
    },
  );

  fastify.post(
    "/usuarios/:id_usuario/pozos/:id_pozo/perfil-litologico/vista-previa",
    {
      schema: {
        summary: "Generar una vista previa no persistente del perfil",
        description: "Valida un borrador técnico y reutiliza el modelo visual canónico",
        tags: ["informes"],
        params: Type.Object({ id_usuario: Type.Integer(), id_pozo: Type.Integer() }),
        body: PerfilLitologicoVistaPreviaBody,
        response: { 200: Type.Unknown(), 400: err.ErrorSchema, 404: err.ErrorSchema },
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.pozoIsFromUser, fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async function (req, rep) {
      const borrador = req.body as import("../models/schemas.ts").PerfilLitologicoVistaPreviaBody;
      const errores = validarDatosTecnicosPozo(borrador);
      if (errores.length) throw new err.T05DatosIncorrectos(errores.join(" "));
      return rep.code(200).send(crearPerfilLitologico(
        borrador.intervalos_litologicos,
        borrador.profundidad_final_m,
        borrador.niveles_aporte,
        borrador.intervalos_diametro,
        borrador.intervalos_filtro,
      ));
    },
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
      preHandler: [fastify.pozoIsFromUser, fastify.userIsPropietarioOrPerforadorOrAdmin],
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
