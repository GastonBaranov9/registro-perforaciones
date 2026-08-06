import type { FastifyInstance } from "fastify";
import { Type } from "@fastify/type-provider-typebox";
import { IntervaloFiltro, IntervaloFiltroBody } from "../models/schemas.ts";
import * as servicio from "../services/intervalos-filtro-service.ts";
import * as err from "../models/errors.ts";

const params = Type.Object({ id_usuario: Type.Integer(), id_pozo: Type.Integer() });
const paramsId = Type.Intersect([params, Type.Object({ id_intervalo_filtro: Type.Integer() })]);
export default async function rutasFiltros(fastify: FastifyInstance) {
  const lectura = [fastify.authenticate, fastify.pozoIsFromUser, fastify.userIsPropietarioOrPerforadorOrAdmin];
  const escritura = [fastify.authenticate, fastify.pozoIsFromUser, fastify.userIsAdminOrPerforador];
  fastify.get("/usuarios/:id_usuario/pozos/:id_pozo/intervalos_filtro", { schema:{params,response:{200:Type.Array(IntervaloFiltro)}}, onRequest:[fastify.authenticate],preHandler:lectura.slice(1) }, async (req) => servicio.listarFiltros((req.params as {id_pozo:number}).id_pozo));
  fastify.post("/usuarios/:id_usuario/pozos/:id_pozo/intervalos_filtro", { schema:{params,body:IntervaloFiltroBody,response:{201:IntervaloFiltro}},onRequest:[fastify.authenticate],preHandler:escritura.slice(1) }, async (req,rep) => rep.code(201).send(await servicio.crearFiltro((req.params as {id_pozo:number}).id_pozo, req.body as typeof IntervaloFiltroBody.static)));
  fastify.put("/usuarios/:id_usuario/pozos/:id_pozo/intervalos_filtro/:id_intervalo_filtro", { schema:{params:paramsId,body:IntervaloFiltroBody,response:{200:IntervaloFiltro}},onRequest:[fastify.authenticate],preHandler:escritura.slice(1) }, async (req) => { const p=req.params as {id_pozo:number;id_intervalo_filtro:number}; const dato=await servicio.actualizarFiltro(p.id_pozo,p.id_intervalo_filtro,req.body as typeof IntervaloFiltroBody.static); if(!dato) throw new err.T05RegistroNoEncontrado(); return dato; });
  fastify.delete("/usuarios/:id_usuario/pozos/:id_pozo/intervalos_filtro/:id_intervalo_filtro", { schema:{params:paramsId,response:{204:Type.Null()}},onRequest:[fastify.authenticate],preHandler:escritura.slice(1) }, async (req,rep) => { const p=req.params as {id_pozo:number;id_intervalo_filtro:number}; if(!await servicio.eliminarFiltro(p.id_pozo,p.id_intervalo_filtro)) throw new err.T05RegistroNoEncontrado(); return rep.code(204).send(null); });
}
