import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { Usuario, Rol, Sitio } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { SitioBody } from "../models/schemas.ts";
import * as func from '../services/sitios-service.ts'
import { rolUser } from "../services/auth-services.ts";
import { configuracionMapaDesdeEntorno, leerCoordenadas, mapaConfigurado, obtenerMapaEstatico } from "../pdf/mapa-estatico.ts";
import { sitioEsGestionablePorPerforador } from "../services/autorizacion-recursos.ts";
import { isAdmin } from "../services/roles-services.ts";
//intervalo litologico, intervalo de diámetro, revestimiento, cementación, desarrollo y nivel de aporte. Cementacion esta hecho y litologia casi hecho. Anda haciendo alguna otra de esas
//Otra cosa, de esas cosas hay q ver cuales un pozo puede tener 1 o mas. Así vemos si necesitan id o no.

const sitiosRoutes= async function (
  fastify: FastifyInstance,
  options: object
) {
  fastify.get(
    "/mapas/estado",
    {
      schema: { summary: "Consultar disponibilidad del proveedor de mapas", tags: ["sitios"],
        response: { 200: Type.Object({ configurado: Type.Boolean(), atribucion: Type.Optional(Type.String()) }) } },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async () => {
      const configuracion = configuracionMapaDesdeEntorno();
      return { configurado: mapaConfigurado(configuracion), ...(mapaConfigurado(configuracion) ? { atribucion: configuracion.atribucion } : {}) };
    },
  );
  fastify.get(
    "/usuarios/:id_usuario/sitios/:id_sitio/mapa-aereo/preview",
    {
      schema: {
        summary: "Previsualizar mapa aÃ©reo con coordenadas pendientes",
        tags: ["sitios"],
        params: Type.Object({ id_usuario: Type.Integer(), id_sitio: Type.Integer() }),
        querystring: Type.Object({ latitud: Type.String(), longitud: Type.String() }),
        response: { 400: err.ErrorSchema, 404: err.ErrorSchema, 503: err.ErrorSchema },
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async (req, rep) => {
      const { id_sitio } = req.params as { id_sitio: number };
      const { latitud, longitud } = req.query as { latitud: string; longitud: string };
      const [administrador, gestionable] = await Promise.all([
        isAdmin(req.user.sub), sitioEsGestionablePorPerforador(id_sitio, req.user.sub),
      ]);
      if (!administrador && !gestionable) throw new err.T05SitioNoEncontrado();
      const sitio = administrador || gestionable
        ? await func.getSitioById(id_sitio)
        : await func.getSitioPropioById(id_sitio, req.user.sub);
      if (!sitio) throw new err.T05SitioNoEncontrado();
      const coordenadas = leerCoordenadas(latitud, longitud);
      if (!coordenadas) throw new err.T05DatosIncorrectos("Las coordenadas del preview no son vÃ¡lidas.");
      const configuracion = configuracionMapaDesdeEntorno();
      if (!mapaConfigurado(configuracion)) throw new err.T05ErrorConexion("Mapa aÃ©reo no configurado");
      const mapa = await obtenerMapaEstatico(coordenadas, configuracion);
      if (mapa.estado === "no-disponible") throw new err.T05ErrorConexion("Mapa aÃ©reo no disponible");
      return rep.header("Content-Type", mapa.tipo).header("X-Map-Attribution", mapa.atribucion)
        .header("Cache-Control", "private, no-store").send(Buffer.from(mapa.bytes));
    },
  );
  fastify.get(
    "/usuarios/:id_usuario/sitios/:id_sitio/mapa-aereo",
    {
      schema: {
        summary: "Obtener imagen aérea protegida del sitio",
        tags: ["sitios"],
        params: Type.Object({ id_usuario: Type.Integer(), id_sitio: Type.Integer() }),
        response: { 404: err.ErrorSchema, 503: err.ErrorSchema },
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async (req, rep) => {
      const { id_sitio } = req.params as { id_sitio: number };
      const [propietario,administrador,gestionable]=await Promise.all([
        rolUser(req.user.sub,"propietario"),isAdmin(req.user.sub),sitioEsGestionablePorPerforador(id_sitio,req.user.sub),
      ]);
      if (!propietario && !administrador && !gestionable) throw new err.T05SitioNoEncontrado();
      const sitio = administrador||gestionable
        ? await func.getSitioById(id_sitio)
        : await func.getSitioPropioById(id_sitio, req.user.sub);
      if (!sitio) throw new err.T05SitioNoEncontrado();
      const coordenadas = leerCoordenadas(sitio.latitud ?? null, sitio.longitud ?? null);
      if (!coordenadas) throw new err.T05SitioNoEncontrado("El sitio no tiene coordenadas válidas.");
      const configuracion = configuracionMapaDesdeEntorno();
      if (!mapaConfigurado(configuracion)) throw new err.T05ErrorConexion("Mapa aéreo no configurado");
      const mapa = await obtenerMapaEstatico(coordenadas, configuracion);
      if (mapa.estado === "no-disponible") throw new err.T05ErrorConexion("Mapa aéreo no disponible");
      return rep.header("Content-Type", mapa.tipo).header("X-Map-Attribution", mapa.atribucion)
        .header("Cache-Control", "private, no-store").send(Buffer.from(mapa.bytes));
    },
  );
  //Crear un sitio
  fastify.post(
    "/usuarios/:id_usuario/sitios",
    {
      schema: {
        summary: "Crear un sitio",
        description: "Rol: Administrador",
        tags: ["sitios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
        }),
        body: SitioBody,
        response: {
          201: Sitio,
          403: err.ErrorSchema,
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async function (req, rep) {
      if (!(await isAdmin(req.user.sub))) throw new err.T05SinPermiso();
      const data = req.body as SitioBody
      const nuevoSitio = await func.createSitio(data)
      return rep.code(201).send(nuevoSitio)
    }
  );

  //Editar un sitio
  fastify.put(
    "/usuarios/:id_usuario/sitios/:id_sitio",
    {
      schema: {
        summary: "Editar un sitio",
        description: "Rol: Administrador/Perforador",
        tags: ["sitios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_sitio: Type.Integer(),
        }),
        body: SitioBody,
        response: {
          200: Sitio,
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async function (req, rep) {
      const {id_sitio} = req.params as {
        id_sitio:number
      }
      const data = req.body as SitioBody;
      if (!(await isAdmin(req.user.sub)) && !(await sitioEsGestionablePorPerforador(id_sitio,req.user.sub)))
        throw new err.T05SitioNoEncontrado();
      const sitioEditado = await func.updateSitio(id_sitio, data)
      if(!sitioEditado) throw err.T05SitioNoEncontrado
      return rep.code(200).send(sitioEditado)
    }
  );

  //Borrar un sitio
  fastify.delete(
    "/usuarios/:id_usuario/sitios/:id_sitio",
    {
      schema: {
        summary: "Borrar un sitio",
        description: "Rol: Administrador/Perforador",
        tags: ["sitios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_sitio: Type.Integer(),
        }),
        response: {
          204: Type.Null(),
          501: err.ErrorSchema,
          404: err.ErrorSchema,
          409: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async function (req, rep) {
      const {id_sitio} = req.params as {
        id_sitio: number
      }
      if (!(await isAdmin(req.user.sub))) throw new err.T05SinPermiso();
      if (await func.sitioTienePozos(id_sitio)) throw new err.T05IntegridadReferencial();
      const sitioBorrado = await func.deleteSitio(id_sitio)
      if(!sitioBorrado) throw new err.T05SitioNoEncontrado
      return rep.code(204).send()
    }
  );
  //Obtener un sitio
  fastify.get(
    "/usuarios/:id_usuario/sitios/:id_sitio",
    {
      schema: {
        summary: "Obtener un sitio",
        description: "Rol: Administrador/Perforador",
        tags: ["sitios"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_sitio: Type.Integer(),
        }),
        response: {
          200: Sitio,
          501: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async function (req, rep) {
      const {id_sitio} = req.params as {
        id_sitio: number
      }
      const { sub } = req.user;
      const [propietario,administrador,gestionable]=await Promise.all([
        rolUser(sub,"propietario"),isAdmin(sub),sitioEsGestionablePorPerforador(id_sitio,sub),
      ]);
      if (!propietario && !administrador && !gestionable) throw new err.T05SitioNoEncontrado();
      const sitioObtenido = administrador||gestionable
        ? await func.getSitioById(id_sitio)
        : await func.getSitioPropioById(id_sitio, sub)
      if(!sitioObtenido)throw new err.T05SitioNoEncontrado
      return rep.code(200).send(sitioObtenido)
    }
  );
  //Obtener  la lista de sitios
  fastify.get(
    "/usuarios/:id_usuario/sitios",
    {
      schema: {
        summary: "Obtener la lista de sitios",
        description: "Rol: Administrador/Perforador",
        params: Type.Object({
          id_usuario: Type.Integer(),
        }),
        tags: ["sitios"],
        response: {
          200: Type.Array(Sitio),
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async function (req, rep) {
      const { sub } = req.user;
      const listaSitios = await isAdmin(sub)
        ? await func.getAllSitios()
        : await rolUser(sub, "propietario")
          ? await func.getSitiosByPropietario(sub)
          : await func.getSitiosByPerforador(sub)
      return rep.code(200).send(listaSitios)
    }
  );
};
export default sitiosRoutes;
