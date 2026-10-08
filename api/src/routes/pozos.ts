import { vincularPropietarioPozo } from "../services/propietario-pozo-service.ts";
import { cerrarOperacionOffline } from '../services/offline-cierre-service.ts';
import { obtenerEpoca } from '../services/epoca-datos-service.ts';
import { validarNumeroPerforacion } from "../services/numeracion-perforacion-service.ts";
import type { FastifyInstance } from "fastify";
import { PozoListado } from "../models/schemas.ts";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { CandidatoPozo, Estado, NuevoPozo, Pozo, PozoCompletoBody, PozoCompletoUpdateBody, PozoDetalle, PropietarioOperativo, PropietarioOperativoActualizarBody, PropietarioOperativoCrearBody, Usuario } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { Type } from "@fastify/type-provider-typebox";
import * as funcPozo from "../services/pozos-services.ts";
import { isAdmin, isPerf, isProp } from "../services/roles-services.ts";
import fs from "fs/promises";
import { clientConnections } from "../plugins/websocket.ts";
import { actualizarPozoCompleto, crearPozoCompleto } from "../services/pozo-completo-service.ts";
import { eliminarFotoPersistida, eliminarPozoPersistido, reemplazarFotoPersistida } from "../services/foto-pozo-service.ts";
import { actualizarPropietarioOperativo, crearPropietarioOperativo, listarCandidatosPozo, obtenerPropietarioOperativo } from "../services/candidatos-pozo-service.ts";
import { leerFotoPozo, validarFotoBuffer } from "../services/foto-archivo-service.ts";
import { FOTO_JSON_BODY_LIMIT_BYTES, MAX_FOTO_BYTES } from "../constants/fotos.ts";
import { cargarConfiguracionRuntime } from "../config/runtime.ts";
import { exportarKml, KML_CONTENT_TYPE, KML_FILENAME } from '../services/exportar-kml-service.ts';

const pozoRoutes = async function (fastify: FastifyInstance, options: object) {
  const { fotosDir } = cargarConfiguracionRuntime();
  fastify.get('/pozos/exportar/kml', {
    onRequest: [fastify.authenticate], preHandler: [fastify.userIsAdmin],
    schema: { summary: 'Administración: exportar perforaciones a Google Earth', tags: ['pozos'] },
  }, async (_req, rep) => {
    const { kml, exportadas, omitidas } = await exportarKml();
    return rep.type(KML_CONTENT_TYPE)
      .header('Content-Disposition', `attachment; filename="${KML_FILENAME}"`)
      .header('Cache-Control', 'no-store')
      .header('X-KML-Exportadas', exportadas)
      .header('X-KML-Omitidas', omitidas)
      .send(kml);
  });
  fastify.get('/pozos/epoca-datos', {
    onRequest: [fastify.authenticate], preHandler: [fastify.userIsAdminOrPerforador],
  }, async (_req, rep) => rep.header('Cache-Control', 'no-store').send({ epoca: await obtenerEpoca() }));
  fastify.post('/pozos/offline/:clave/cerrar', {
    onRequest: [fastify.authenticate], preHandler: [fastify.userIsAdminOrPerforador],
    schema: { params: Type.Object({ clave: Type.String({ format: 'uuid' }) }), response: { 200: Type.Any() } },
  }, async req => cerrarOperacionOffline(Number(req.user.sub), (req.params as { clave: string }).clave, req.headers['x-epoca-datos']));
  fastify.post(
    "/pozos/propietarios",
    {
      schema: {
        summary: "Administración: registrar un propietario real",
        description: "Crea una identidad administrada sin credenciales; los nombres provisionales se guardan en el pozo",
        tags: ["pozos"], body: PropietarioOperativoCrearBody,
        response: { 201: CandidatoPozo, 400: err.ErrorSchema, 403: err.ErrorSchema },
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdmin],
    },
    async (req, rep) => rep.code(201).send(await crearPropietarioOperativo(req.body as import("../models/schemas.ts").PropietarioOperativoCrearBody)),
  );
  fastify.get(
    "/pozos/propietarios/:id_propietario",
    {
      schema: {
        summary: "Obtener un propietario operativo", tags: ["pozos"],
        params: Type.Object({ id_propietario: Type.Integer({ minimum: 1 }) }),
        response: { 200: PropietarioOperativo, 404: err.ErrorSchema },
      },
      onRequest: [fastify.authenticate], preHandler: [fastify.userIsAdmin],
    },
    async (req) => {
      const { id_propietario } = req.params as { id_propietario: number };
      const propietario = await obtenerPropietarioOperativo(id_propietario);
      if (!propietario) throw new err.T05UsuarioNoEncontrado();
      return propietario;
    },
  );
  fastify.put(
    "/pozos/propietarios/:id_propietario",
    {
      schema: {
        summary: "Actualizar datos de un propietario operativo", tags: ["pozos"],
        params: Type.Object({ id_propietario: Type.Integer({ minimum: 1 }) }),
        body: PropietarioOperativoActualizarBody,
        response: { 200: PropietarioOperativo, 400: err.ErrorSchema, 404: err.ErrorSchema },
      },
      onRequest: [fastify.authenticate], preHandler: [fastify.userIsAdmin],
    },
    async (req) => {
      const { id_propietario } = req.params as { id_propietario: number };
      const propietario = await actualizarPropietarioOperativo(id_propietario, req.body as import("../models/schemas.ts").PropietarioOperativoActualizarBody);
      if (!propietario) throw new err.T05UsuarioNoEncontrado();
      return propietario;
    },
  );
  fastify.get(
    "/pozos/candidatos-personas",
    {
      schema: { summary: "Listar personas elegibles para pozos", tags: ["pozos"], querystring: Type.Object({ propietario: Type.Optional(Type.String({ maxLength: 80 })), perforador: Type.Optional(Type.String({ maxLength: 80 })), limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })), propietario_id: Type.Optional(Type.Integer({ minimum: 1 })), perforador_id: Type.Optional(Type.Integer({ minimum: 1 })) }), response: { 200: Type.Object({ propietarios: Type.Array(CandidatoPozo), perforadores: Type.Array(CandidatoPozo) }) } },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async (req) => {
      const q = req.query as { propietario?: string; perforador?: string; limite?: number; propietario_id?: number; perforador_id?: number };
      const admin = await isAdmin(req.user.sub);
      if (!admin && (q.propietario !== undefined || q.propietario_id !== undefined)) throw new err.T05SinPermiso();
      return listarCandidatosPozo(req.user.sub, admin, undefined, { ...q, propietarioId: q.propietario_id, perforadorId: q.perforador_id });
    },
  );
  fastify.post(
    "/usuarios/:id_usuario/pozos/completo",
    {
      bodyLimit: FOTO_JSON_BODY_LIMIT_BYTES,
      preValidation: async (req) => {
        const numero = (req.body as PozoCompletoBody | undefined)?.pozo?.numero_perforacion;
        if (numero != null) validarNumeroPerforacion(numero);
      },
      schema: {
        summary: "Crear un pozo con sus datos técnicos",
        description: "Crea atómicamente el pozo, litología, diámetros, aportes y fotografía opcional",
        params: Type.Object({ id_usuario: Type.Integer() }),
        tags: ["pozos"],
        body: PozoCompletoBody,
        response: { 201: Type.Any(), 400: err.ErrorSchema, 403: err.ErrorSchema },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async (req, rep) => {
      const idUsuarioSesion = Number(req.user.sub);
      const data = req.body as PozoCompletoBody;
      if (!(await isAdmin(idUsuarioSesion))) {
        if (data.pozo.id_perforador !== idUsuarioSesion || data.pozo.id_propietario !== null)
          throw new err.T05SinPermiso();
      }
      if (data.pozo.id_propietario !== null && !(await isProp(data.pozo.id_propietario)))
        throw new err.T05DatosIncorrectos("El ID no es de un propietario");
      if (!(await isPerf(data.pozo.id_perforador)))
        throw new err.T05DatosIncorrectos("El ID no es de un perforador");

      const claveOffline = req.headers['idempotency-key'];
      if (claveOffline !== undefined && typeof claveOffline !== 'string') throw new err.T05DatosIncorrectos();
      const resultado = await crearPozoCompleto(idUsuarioSesion, data, fotosDir, undefined, typeof claveOffline === 'string' ? claveOffline : undefined, req.headers['x-epoca-datos']);
      if (data.pozo.id_propietario !== null) fastify.notifyClient(data.pozo.id_propietario, { type: "pozo" });
      return rep.code(201).send(resultado);
    },
  );

  fastify.put(
    "/usuarios/:id_usuario/pozos/:id_pozo/completo",
    {
      bodyLimit: FOTO_JSON_BODY_LIMIT_BYTES,
      preValidation: async (req) => {
        const numero = (req.body as PozoCompletoUpdateBody | undefined)?.pozo?.numero_perforacion;
        if (numero != null) validarNumeroPerforacion(numero);
      },
      schema: {
        summary: "Actualizar un pozo y todos sus datos técnicos",
        params: Type.Object({ id_usuario: Type.Integer(), id_pozo: Type.Integer() }),
        tags: ["pozos"], body: PozoCompletoUpdateBody, response: { 200: Type.Any(), 400: err.ErrorSchema, 404: err.ErrorSchema },
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.pozoIsFromUser, fastify.userIsAdminOrPerforador],
    },
    async (req, rep) => {
      const { id_pozo } = req.params as { id_pozo: number };
      const data = req.body as PozoCompletoUpdateBody;
      const idUsuarioSesion=Number(req.user.sub);
      if (!(await isAdmin(idUsuarioSesion)) && data.pozo.id_perforador !== idUsuarioSesion) throw new err.T05SinPermiso();
      const resultado = await actualizarPozoCompleto(id_pozo, data, fotosDir, undefined, { logger: req.log });
      if (resultado.pozo.id_propietario !== null) fastify.notifyClient(resultado.pozo.id_propietario, { type: "pozo" });
      return rep.code(200).send(resultado);
    },
  );

  fastify.put("/pozos/:id_pozo/propietario", {
    onRequest: [fastify.authenticate], preHandler: [fastify.userIsAdmin],
    schema: {
      summary: "Administración: vincular un propietario real al pozo",
      tags: ["pozos"], security: [{ BearerAuth: [] }],
      params: Type.Object({ id_pozo: Type.Integer({ minimum: 1 }) }),
      body: Type.Object({ id_propietario: Type.Integer({ minimum: 1 }), id_propietario_esperado: Type.Unsafe<number | null>({ type: ["integer", "null"], minimum: 1 }) }, { additionalProperties: false }),
      response: { 200: Type.Any(), 400: err.ErrorSchema, 403: err.ErrorSchema, 404: err.ErrorSchema },
    },
  }, async (req) => {
    const { id_pozo } = req.params as { id_pozo: number };
    const body = req.body as { id_propietario: number; id_propietario_esperado: number | null };
    const resultado = await vincularPropietarioPozo(id_pozo, body.id_propietario, body.id_propietario_esperado, Number(req.user.sub));
    fastify.notifyClient(body.id_propietario, { type: "pozo" });
    return resultado;
  });

  //Crear pozo (estado inicial: ingresando)
  fastify.post(
    "/usuarios/:id_usuario/pozos",
    {
      schema: {
        summary: "Creación legacy deshabilitada",
        description: "Use /pozos/completo con sitio_nuevo para garantizar atomicidad",
        params: Type.Object({
          id_usuario: Type.Integer(),
        }),
        tags: ["pozos"],
        body: NuevoPozo,
        response: {
          201: Pozo,
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async (req, rep) => {
      throw new err.T05DatosIncorrectos("La creación de un pozo requiere una ubicación nueva dentro de la operación completa.");
    }
  );

  //Editar o completar la información de un pozo
  fastify.put(
    "/usuarios/:id_usuario/pozos/:id_pozo",
    {
      schema: {
        summary: "Editar un pozo",
        description: "Rol: Perforador",
        tags: ["pozos"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
        }),
        body: NuevoPozo,
        response: {
          200: Pozo,
          501: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.pozoIsFromUser, fastify.userIsAdminOrPerforador],
    },
    async (req, rep) => {
      const { sub: id_usuario } = req.user;
      const data = req.body as NuevoPozo;

      if (!(await isAdmin(id_usuario)) && data.id_perforador !== id_usuario)
        throw new err.T05SinPermiso();

      const isPropietario = data.id_propietario === null || await isProp(data.id_propietario);
      const isPerforador = await isPerf(data.id_perforador);

      if (isPropietario === false)
        throw new err.T05DatosIncorrectos("El ID no es de un propietario");
      if (isPerforador === false)
        throw new err.T05DatosIncorrectos("El ID no es de un perforador");

      const { id_pozo } = req.params as { id_pozo: number };
      const pozoEditado = await funcPozo.updatePozo(id_pozo, data);
      if (!pozoEditado) {
        throw new err.T05PozoNoEncontrado();
      }
      if (data.id_propietario !== null) fastify.notifyClient(data.id_propietario, { type: "editpozo" })
      return rep.code(200).send(pozoEditado);
    }
  );

  //Obtener un pozo en específico
  fastify.get(
    "/usuarios/:id_usuario/pozos/:id_pozo",
    {
      schema: {
        summary: "Obtener un pozo en específico",
        description: "Rol: Propietario/Perforador",
        tags: ["pozos"],
        params: Type.Object({
          id_usuario: Type.Integer({
            description: "ID del usuario propietario",
          }),
          id_pozo: Type.Integer({ description: "ID del pozo a consultar" }),
        }),
        response: {
          200: PozoDetalle,
          501: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [
        fastify.pozoIsFromUser,
        fastify.userIsPropietarioOrPerforadorOrAdmin,
      ],
    },
    async (req, rep) => {
      const { id_pozo } = req.params as {
        id_usuario: number;
        id_pozo: number;
      };
      const pozo = await funcPozo.getPozoById(id_pozo);
      if (!pozo) {
        throw new err.T05PozoNoEncontrado();
      }
      return rep.code(200).send(pozo);
    }
  );

  //Obtener todos los pozos
  fastify.get(
    "/usuarios/:id_usuario/pozos",
    {
      schema: {
        summary: "Obtener todos los pozos",
        description: "Rol: Administrador/Perforador",
        tags: ["pozos"],
        params: Type.Object({
          id_usuario: Type.Integer(),
        }),
        querystring: Type.Object({
          caudal_min: Type.Optional(Type.Number()),
          caudal_max: Type.Optional(Type.Number()),
          profundidad_min: Type.Optional(Type.Number()),
          profundidad_max: Type.Optional(Type.Number()),
          sello_sanitario: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Array(PozoListado),
          501: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
    },
    async (req, rep) => {
      const { sub: id_usuario } = req.user;
      const {
        caudal_min,
        caudal_max,
        profundidad_min,
        profundidad_max,
        sello_sanitario,
      } = req.query as {
        caudal_min?: number;
        caudal_max?: number;
        profundidad_max?: number;
        profundidad_min?: number;
        sello_sanitario?: boolean;
      };

      let sello: boolean | undefined = undefined;

      if (sello_sanitario === true) sello = true;
      if (sello_sanitario === false) sello = false;
      const isPropietario = await isProp(id_usuario);
      const isPerforador = await isPerf(id_usuario);
      const isAdministrador = await isAdmin(id_usuario);
      if (isAdministrador) {
        const pozos = await funcPozo.getAllPozo(
          caudal_min,
          caudal_max,
          profundidad_max,
          profundidad_min,
          sello_sanitario
        );
        return rep.code(200).send(pozos);
      }
      if (isPropietario) {
        const pozos = await funcPozo.getPozosByPropietario(
          id_usuario,
          caudal_min,
          caudal_max,
          profundidad_max,
          profundidad_min,
          sello
        );
        return rep.code(200).send(pozos);
      }

      if (isPerforador) {
        const pozos = await funcPozo.getPozosByPerforador(
          id_usuario,
          caudal_min,
          caudal_max,
          profundidad_max,
          profundidad_min,
          sello_sanitario
        );
        return rep.code(200).send(pozos);
      }
      throw new err.T05SinPermiso("Se debe tener un rol");
    }
  );
  // Borrar un pozo
  fastify.delete(
    "/usuarios/:id_usuario/pozos/:id_pozo",
    {
      schema: {
        summary: "Borrar un pozo",
        description: "Rol: Administración",
        tags: ["pozos"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
        }),
        response: {
          204: Type.Null(),
          501: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdmin],
    },
    async (req, rep) => {
      const { id_pozo } = req.params as {
        id_usuario: number;
        id_pozo: number;
      };

      const pozo = await funcPozo.getPozoById(id_pozo)
      if (!pozo) throw new err.T05PozoNoEncontrado();
      await eliminarPozoPersistido(id_pozo, fotosDir, undefined, { logger: req.log });
      if (pozo.id_propietario !== null) fastify.notifyClient(pozo.id_propietario, { type: "deletepozo" })

      return rep.code(204).send();
    }
  );
  fastify.post(
    "/usuarios/:id_usuario/pozos/:id_pozo/foto",
    {
      schema: {
        summary: "Agregar la foto a un pozo",
        description: "Rol: Perforador",
        tags: ["pozos"],
        params: Type.Object({
          id_usuario: Type.Integer(),
          id_pozo: Type.Integer(),
        }),
        body: Type.Any(),

        response: {
          200: Pozo,
          501: err.ErrorSchema,
          404: err.ErrorSchema,
        },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.pozoIsFromUser, fastify.userIsAdminOrPerforador],
    },
    async (req, rep) => {
      const { id_pozo } = req.params as {
        id_pozo: number;
      };
      const { sub: id_usuario } = req.user;

      await fastify.rateLimitUpload(req, rep);
      if (rep.sent) return;

      const foto = await (req as any).file?.();
      if (!foto)
        throw new err.T05DatosIncorrectos("No se recibió archivo de foto");

      await fs.mkdir(fotosDir, { recursive: true });

      const buffer = await foto.toBuffer();
      if (buffer.length === 0 || buffer.length > MAX_FOTO_BYTES)
        throw new err.T05DatosIncorrectos("La fotografía debe pesar entre 1 byte y 5 MB.");
      const validada = validarFotoBuffer(buffer, foto.mimetype);
      const fotoUrl = `/usuarios/${id_usuario}/pozos/${id_pozo}/foto`;
      const pozoActualizado = await reemplazarFotoPersistida(
        id_pozo, fotosDir, validada, fotoUrl, async (client,url) => {
          const actualizado = await funcPozo.updatePozoFoto(id_pozo, url,client);
          if (!actualizado) throw new err.T05PozoNoEncontrado();
          return actualizado;
        },undefined,{logger:req.log},
      );

      return rep.code(200).send(pozoActualizado);
    }
  );

  fastify.delete(
    "/usuarios/:id_usuario/pozos/:id_pozo/foto",
    {
      schema: {
        summary: "Eliminar la fotografía protegida de un pozo",
        tags: ["pozos"],
        params: Type.Object({ id_usuario: Type.Integer(), id_pozo: Type.Integer() }),
        response: { 204: Type.Null(), 404: err.ErrorSchema, 500: err.ErrorSchema },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.pozoIsFromUser, fastify.userIsAdminOrPerforador],
    },
    async (req, rep) => {
      const { id_pozo } = req.params as { id_pozo: number };
      const pozo = await funcPozo.getPozoById(id_pozo);
      if (!pozo) throw new err.T05PozoNoEncontrado();

      await eliminarFotoPersistida(id_pozo, fotosDir, undefined, { logger: req.log });
      return rep.code(204).send(null);
    },
  );

  fastify.get(
    "/usuarios/:id_usuario/pozos/:id_pozo/foto",
    {
      schema: {
        summary: "Descargar la foto protegida de un pozo",
        tags: ["pozos"],
        params: Type.Object({ id_usuario: Type.Integer(), id_pozo: Type.Integer() }),
        response: { 404: err.ErrorSchema },
        security: [{ BearerAuth: [] }],
      },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.pozoIsFromUser, fastify.userIsPropietarioOrPerforadorOrAdmin],
    },
    async (req, rep) => {
      const { id_pozo } = req.params as { id_pozo: number };
      const pozo = await funcPozo.getPozoById(id_pozo);
      if (!pozo?.foto_url) throw new err.T05PozoNoEncontrado();
      const foto = await leerFotoPozo(id_pozo, fotosDir);
      if (!foto) throw new err.T05PozoNoEncontrado();
      const contentType = foto.nombre.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      return rep.type(contentType).send(foto.buffer);
    }
  );
};
export default pozoRoutes;
