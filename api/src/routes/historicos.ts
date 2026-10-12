import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { HistoricoBody, HistoricoUpdateBody, validarHistorico, validarEdicionHistorica } from '../models/historicos.ts';
import { crearHistorico, editarHistorico } from '../services/historicos-service.ts';
import { FOTO_JSON_BODY_LIMIT_BYTES } from '../constants/fotos.ts';

export default async function historicosRoutes(app: FastifyInstance) {
  app.post('/pozos/historicos', {
    bodyLimit: FOTO_JSON_BODY_LIMIT_BYTES,
    onRequest: [app.authenticate], preHandler: [app.puedeGestionarHistoricos],
    preValidation: async req => validarHistorico(req.body),
    schema: { body: HistoricoBody, tags: ['pozos'] },
  }, async (req, rep) => rep.code(201).send(await crearHistorico(Number(req.user.sub), req.body as HistoricoBody,
    req.headers['idempotency-key'], req.headers['x-epoca-datos'])));
  app.patch('/pozos/historicos/:id_pozo', {
    bodyLimit:FOTO_JSON_BODY_LIMIT_BYTES,
    onRequest:[app.authenticate],preHandler:[app.puedeGestionarHistoricos],
    preValidation:async req=>validarEdicionHistorica(req.body),
    schema:{params:Type.Object({id_pozo:Type.Integer({minimum:1})}),body:HistoricoUpdateBody,tags:['pozos']},
  },async req=>editarHistorico(Number(req.user.sub),Number((req.params as {id_pozo:number}).id_pozo),req.body as HistoricoUpdateBody));
}
