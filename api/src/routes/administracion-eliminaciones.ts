import type { FastifyInstance } from 'fastify';
import { Type } from '@fastify/type-provider-typebox';
import { consultarEliminacion, ejecutarEliminacion, type ConfirmacionEliminacion } from '../services/administracion-eliminaciones-service.ts';
import { cargarConfiguracionRuntime } from '../config/runtime.ts';

export const ConfirmacionEliminacionBody = Type.Object({
  token:Type.String({minLength:1,maxLength:4096}), confirmacion:Type.String({maxLength:20}),
  motivo:Type.String({minLength:10,maxLength:1000}),
  prueba_confirmada:Type.Optional(Type.Boolean()), sin_referencias_externas:Type.Optional(Type.Boolean()),
},{additionalProperties:false});

export default async function administracionEliminaciones(fastify:FastifyInstance) {
  const seguridad={onRequest:[fastify.authenticate],preHandler:[fastify.userIsAdmin]};
  const params={params:Type.Object({valor:Type.Integer({minimum:1,maximum:2147483647})})};
  fastify.get('/pozos/:valor/confirmacion-eliminacion',{
    ...seguridad,schema:{...params,querystring:Type.Object({prueba:Type.Optional(Type.Literal('true'))})},
  },async(req,rep)=>rep.header('Cache-Control','no-store').send(await consultarEliminacion(Number(req.user.sub),
    (req.query as {prueba?:string}).prueba==='true'?'eliminar_prueba':'eliminar',(req.params as {valor:number}).valor)));
  fastify.get('/pozos/numeracion/eliminadas/:valor',{...seguridad,schema:params},
    async(req,rep)=>rep.header('Cache-Control','no-store').send(await consultarEliminacion(Number(req.user.sub),'liberar_reserva',(req.params as {valor:number}).valor)));
  fastify.post('/pozos/numeracion/eliminadas/:valor/liberar',{
    ...seguridad,schema:{...params,body:ConfirmacionEliminacionBody},
  },async req=>ejecutarEliminacion(Number(req.user.sub),'liberar_reserva',(req.params as {valor:number}).valor,
    req.body as ConfirmacionEliminacion,cargarConfiguracionRuntime().fotosDir));
}
