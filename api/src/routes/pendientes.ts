import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { listarPendientes, vincularPendientes, type VinculacionPendiente } from '../services/pendientes-service.ts';

export default async function pendientesRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate], preHandler: [app.userIsAdmin] };
  app.get('/administracion/personas-pendientes', auth, req => listarPendientes(Number(req.user.sub)));
  app.get('/administracion/litologias-pendientes', auth, req => listarPendientes(Number(req.user.sub),true));
  app.post('/administracion/pendientes/vincular', { ...auth, schema: { body: Type.Object({
    tipo: Type.Union([Type.Literal('propietario'),Type.Literal('perforador'),Type.Literal('litologia')]),
    destino: Type.Integer({ minimum: 1 }),
    ocurrencias: Type.Array(Type.Object({
      id: Type.Integer({ minimum: 1 }), id_pozo: Type.Integer({ minimum: 1 }),
      texto: Type.String({ minLength: 1, maxLength: 160 }),
      version: Type.String({ pattern: '^\\d+$' }), version_pozo: Type.String({ pattern: '^\\d+$' }),
    },{ additionalProperties: false }),{ minItems: 1, maxItems: 1000 }),
  },{ additionalProperties: false }) } }, req => vincularPendientes(Number(req.user.sub),req.body as VinculacionPendiente));
}
