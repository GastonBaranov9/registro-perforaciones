import type { FastifyInstance } from "fastify";
import { Type } from "@fastify/type-provider-typebox";
import { LitologiaActualizarBody, LitologiaCatalogo, LitologiaCrearBody, LitologiaPublica } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import * as servicio from "../services/litologias-services.ts";

const params = Type.Object({ id_litologia: Type.Integer({ minimum: 1 }) });
export default async function rutasLitologias(fastify: FastifyInstance) {
  fastify.get("/litologias", { schema:{querystring:Type.Object({incluir_inactivas:Type.Optional(Type.Boolean())}),response:{200:Type.Array(LitologiaPublica)}},onRequest:[fastify.authenticate] }, async (req, rep) => {
    const incluir = (req.query as {incluir_inactivas?:boolean}).incluir_inactivas === true;
    if (incluir) await fastify.userIsAdmin(req, rep);
    return servicio.listarLitologias(incluir);
  });
  fastify.get("/litologias/:id_litologia", { schema:{params,response:{200:LitologiaPublica,404:err.ErrorSchema}},onRequest:[fastify.authenticate] }, async (req) => {
    const dato=await servicio.obtenerLitologia((req.params as {id_litologia:number}).id_litologia); if(!dato)throw new err.T05RegistroNoEncontrado(); return dato;
  });
  fastify.post("/litologias", { schema:{body:LitologiaCrearBody,response:{201:LitologiaCatalogo,400:err.ErrorSchema,409:err.ErrorSchema}},onRequest:[fastify.authenticate],preHandler:[fastify.userIsAdmin] }, async(req,rep)=>rep.code(201).send(await servicio.crearLitologia(req.body as LitologiaCrearBody)));
  fastify.put("/litologias/:id_litologia", { schema:{params,body:LitologiaActualizarBody,response:{200:LitologiaCatalogo}},onRequest:[fastify.authenticate],preHandler:[fastify.userIsAdmin] }, async(req)=>{const dato=await servicio.actualizarLitologia((req.params as {id_litologia:number}).id_litologia,req.body as LitologiaActualizarBody);if(!dato)throw new err.T05RegistroNoEncontrado();return dato;});
  for (const [ruta,activo] of [["activar",true],["desactivar",false]] as const) fastify.patch(`/litologias/:id_litologia/${ruta}`, {schema:{params,response:{200:LitologiaCatalogo}},onRequest:[fastify.authenticate],preHandler:[fastify.userIsAdmin]},async(req)=>{const dato=await servicio.cambiarEstadoLitologia((req.params as {id_litologia:number}).id_litologia,activo);if(!dato)throw new err.T05RegistroNoEncontrado();return dato;});
}
