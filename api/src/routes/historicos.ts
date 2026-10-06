import type { FastifyInstance } from 'fastify';
import { HistoricoBody, validarHistorico } from '../models/historicos.ts';
import { crearHistorico } from '../services/historicos-service.ts';

export default async function historicosRoutes(app: FastifyInstance) {
  app.post('/pozos/historicos', {
    onRequest: [app.authenticate], preHandler: [app.userIsAdmin],
    preValidation: async req => validarHistorico(req.body),
    schema: { body: HistoricoBody, tags: ['pozos'] },
  }, async (req, rep) => rep.code(201).send(await crearHistorico(Number(req.user.sub), req.body as HistoricoBody,
    req.headers['idempotency-key'], req.headers['x-epoca-datos'])));
}
