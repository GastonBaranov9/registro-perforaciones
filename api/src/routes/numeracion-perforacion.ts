import type { FastifyInstance } from "fastify";
import { Type } from "@fastify/type-provider-typebox";
import { NumeroPerforacion } from "../models/schemas.ts";
import { ErrorSchema } from "../models/errors.ts";
import { validarNumeroPerforacion, asignarNumeroPendiente, configurarNumeracion, consultarNumero, obtenerNumeracion } from "../services/numeracion-perforacion-service.ts";
import { previsualizarRectificacion, rectificarNumeracion, type SolicitudRectificacion } from '../services/rectificacion-numeracion-service.ts';

export default async function numeracionRoutes(fastify: FastifyInstance) {
  const seguridad = { onRequest: [fastify.authenticate], preHandler: [fastify.userIsAdmin] };
  const estado = Type.Object({
    proximo: Type.Union([Type.Integer(), Type.Null()]),
    minimo: Type.Integer(), agotado: Type.Boolean(),
  });
  const errores = { 400: ErrorSchema, 403: ErrorSchema, 409: ErrorSchema };
  fastify.get('/pozos/numeracion/rectificacion/:desde', {
    ...seguridad, schema: { params: Type.Object({ desde: Type.Integer({ minimum: 3282, maximum: 2147483647 }) }) },
  }, async (req,rep) => rep.header('Cache-Control','no-store').send(await previsualizarRectificacion(Number(req.user.sub), (req.params as { desde: number }).desde)));
  fastify.post('/pozos/numeracion/rectificacion', {
    ...seguridad, schema: { body: Type.Object({
      token: Type.String({minLength:1,maxLength:4096}), confirmacion: Type.Literal('RECTIFICAR'), pruebas_confirmadas: Type.Literal(true),
      desde: Type.Integer({ minimum: 3282, maximum: 2147483647 }),
      esperado: Type.Integer({ minimum: 3283, maximum: 2147483648 }),
      mayor_esperado: NumeroPerforacion,
      motivo: Type.String({ minLength: 10, maxLength: 1000 }),
      sin_referencias_externas: Type.Literal(true),
      reservas: Type.Array(Type.Object({ numero_perforacion: NumeroPerforacion,
        id_pozo_original: Type.String({ pattern: '^[1-9][0-9]*$' }), asignado_en: Type.String({ minLength: 1, maxLength: 100 }),
      }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }),
    }, { additionalProperties: false }) },
  }, async req => rectificarNumeracion(Number(req.user.sub),req.body as SolicitudRectificacion));
  fastify.get("/pozos/numeracion", {
    ...seguridad, schema: { tags: ["pozos"], response: { 200: estado, ...errores } },
  }, async (req) => obtenerNumeracion(Number(req.user.sub)));
  fastify.put("/pozos/numeracion", {
    preValidation: async (req) => validarNumeroPerforacion((req.body as { proximo?: unknown } | undefined)?.proximo),
    ...seguridad, schema: {
      tags: ["pozos"],
      body: Type.Object({ proximo: NumeroPerforacion, esperado: Type.Union([Type.Integer({ minimum: 1, maximum: 2147483648 }), Type.Null()]), motivo: Type.String({minLength:10,maxLength:1000}) }, { additionalProperties: false }),
      response: { 200: estado, ...errores },
    },
  }, async (req) => {
    const body = req.body as { proximo: number; esperado: number | null; motivo:string };
    return configurarNumeracion(Number(req.user.sub), body.proximo, body.esperado,body.motivo);
  });
  fastify.get("/pozos/numeracion/disponibilidad/:numero", {
    ...seguridad, schema: {
      tags: ["pozos"], params: Type.Object({ numero: NumeroPerforacion }),
      response: { 200: Type.Object({ utilizado: Type.Boolean() }), ...errores },
    },
  }, async (req) => consultarNumero(Number(req.user.sub), (req.params as { numero: number }).numero));
  fastify.patch("/pozos/:id_pozo/numero-perforacion", {
    preValidation: async (req) => validarNumeroPerforacion((req.body as { numero_perforacion?: unknown } | undefined)?.numero_perforacion),
    ...seguridad, schema: {
      tags: ["pozos"], params: Type.Object({ id_pozo: Type.Integer({ minimum: 1 }) }),
      body: Type.Object({ numero_perforacion: NumeroPerforacion }, { additionalProperties: false }),
      response: { 200: Type.Object({ numero_perforacion: NumeroPerforacion }), 404: ErrorSchema, ...errores },
    },
  }, async (req) => asignarNumeroPendiente(Number(req.user.sub),
    (req.params as { id_pozo: number }).id_pozo, (req.body as { numero_perforacion: number }).numero_perforacion));
}
