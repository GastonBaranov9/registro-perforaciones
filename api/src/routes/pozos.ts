import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { CandidatoPozo, Estado, NuevoPozo, Pozo, PozoCompletoBody, PozoCompletoUpdateBody, Usuario } from "../models/schemas.ts";
import * as err from "../models/errors.ts";
import { Type } from "@fastify/type-provider-typebox";
import * as funcPozo from "../services/pozos-services.ts";
import { isAdmin, isPerf, isProp } from "../services/roles-services.ts";
import fs from "fs/promises";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { clientConnections } from "../plugins/websocket.ts";
import { actualizarPozoCompleto, crearPozoCompleto } from "../services/pozo-completo-service.ts";
import { eliminarFotoPersistida } from "../services/foto-pozo-service.ts";
import { randomUUID } from "node:crypto";
import { listarCandidatosPozo } from "../services/candidatos-pozo-service.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

const pozoRoutes = async function (fastify: FastifyInstance, options: object) {
  fastify.get(
    "/pozos/candidatos-personas",
    {
      schema: { summary: "Listar personas elegibles para pozos", tags: ["pozos"], response: { 200: Type.Object({ propietarios: Type.Array(CandidatoPozo), perforadores: Type.Array(CandidatoPozo) }) } },
      onRequest: [fastify.authenticate],
      preHandler: [fastify.userIsAdminOrPerforador],
    },
    async (req) => listarCandidatosPozo(req.user.sub, await isAdmin(req.user.sub)),
  );
  fastify.post(
    "/usuarios/:id_usuario/pozos/completo",
    {
      bodyLimit: 7_500_000,
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
      const { sub: idUsuarioSesion } = req.user;
      const data = req.body as PozoCompletoBody;
      if (!(await isAdmin(idUsuarioSesion)) && data.pozo.id_perforador !== idUsuarioSesion)
        throw new err.T05SinPermiso();
      if (!(await isProp(data.pozo.id_propietario)))
        throw new err.T05DatosIncorrectos("El ID no es de un propietario");
      if (!(await isPerf(data.pozo.id_perforador)))
        throw new err.T05DatosIncorrectos("El ID no es de un perforador");

      const resultado = await crearPozoCompleto(idUsuarioSesion, data, PUBLIC_DIR);
      fastify.notifyClient(data.pozo.id_propietario, { type: "pozo" });
      return rep.code(201).send(resultado);
    },
  );

  fastify.put(
    "/usuarios/:id_usuario/pozos/:id_pozo/completo",
    {
      bodyLimit: 7_500_000,
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
      if (!(await isAdmin(req.user.sub)) && data.pozo.id_perforador !== req.user.sub) throw new err.T05SinPermiso();
      const resultado = await actualizarPozoCompleto(id_pozo, data, PUBLIC_DIR);
      fastify.notifyClient(resultado.pozo.id_propietario, { type: "pozo" });
      return rep.code(200).send(resultado);
    },
  );

  //Crear pozo (estado inicial: ingresando)
  fastify.post(
    "/usuarios/:id_usuario/pozos",
    {
      schema: {
        summary: "Crear un pozo",
        description: "Rol: Perforador",
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
      const { sub: id_usuario } = req.user;
      const data = req.body as NuevoPozo;

      if (!(await isAdmin(id_usuario)) && data.id_perforador !== id_usuario)
        throw new err.T05SinPermiso();

      const isPropietario = await isProp(data.id_propietario);
      const isPerforador = await isPerf(data.id_perforador);

      if (isPropietario === false)
        throw new err.T05DatosIncorrectos("El ID no es de un propietario");
      if (isPerforador === false)
        throw new err.T05DatosIncorrectos("El ID no es de un perforador");

      const nuevoPozo = await funcPozo.createPozo(
        id_usuario,
        req.body as NuevoPozo
      );

      fastify.notifyClient(data.id_propietario, { type: "pozo" })
      return rep.code(201).send(nuevoPozo);
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

      const isPropietario = await isProp(data.id_propietario);
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
      fastify.notifyClient(data.id_propietario, { type: "editpozo" })
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
          200: Pozo,
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
          profunidad_min: Type.Optional(Type.Number()),
          profunidad_max: Type.Optional(Type.Number()),
          sello_sanitario: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Array(Pozo),
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
      if (isPropietario) {
        console.log("ES PROPIETARIO");
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
        console.log("ES PERFORADOR");
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
      if (isAdministrador) {
        console.log("ES ADMIN");
        const pozos = await funcPozo.getAllPozo(
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
        description: "Rol: Perforador/Propietario",
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
      preHandler: [fastify.pozoIsFromUser, fastify.userIsAdminOrPerforador],
    },
    async (req, rep) => {
      const { id_pozo } = req.params as {
        id_usuario: number;
        id_pozo: number;
      };

      const pozo = await funcPozo.getPozoById(id_pozo)
      fastify.notifyClient(pozo.id_propietario, { type: "deletepozo" })
      const borrado = await funcPozo.deletePozo(id_pozo);

      if (!borrado) {
        throw new err.T05PozoNoEncontrado();
      }

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

      const foto = await (req as any).file?.();
      if (!foto)
        throw new err.T05DatosIncorrectos("No se recibió archivo de foto");

      await fs.mkdir(PUBLIC_DIR, { recursive: true });

      const buffer = await foto.toBuffer();
      if (buffer.length === 0 || buffer.length > 5_000_000)
        throw new err.T05DatosIncorrectos("La fotografía debe pesar entre 1 byte y 5 MB.");
      const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
      const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
      if (!jpeg && !png) throw new err.T05DatosIncorrectos("La fotografía debe ser JPEG o PNG.");
      const extension = png ? "png" : "jpg";
      const fileName = `pozo-${id_pozo}.${extension}`;
      const filePath = path.join(PUBLIC_DIR, fileName);
      const existentes = await fs.readdir(PUBLIC_DIR);
      const anterior = existentes.find((nombre) => nombre.startsWith(`pozo-${id_pozo}.`));
      const papelera = path.join(PUBLIC_DIR, ".trash");
      const anteriorOriginal = anterior ? path.join(PUBLIC_DIR, anterior) : null;
      const anteriorAislado = anterior ? path.join(papelera, `${id_pozo}-${randomUUID()}-${anterior}`) : null;
      if (anteriorOriginal && anteriorAislado) {
        await fs.mkdir(papelera, { recursive: true });
        await fs.rename(anteriorOriginal, anteriorAislado);
      }
      await fs.writeFile(filePath, buffer, { flag: "wx" });

      const fotoUrl = `/usuarios/${id_usuario}/pozos/${id_pozo}/foto`;

      let pozoActualizado;
      try {
        pozoActualizado = await funcPozo.updatePozoFoto(id_pozo, fotoUrl);
        if (!pozoActualizado) throw new err.T05PozoNoEncontrado();
      } catch (error) {
        await fs.rm(filePath, { force: true });
        if (anteriorOriginal && anteriorAislado) await fs.rename(anteriorAislado, anteriorOriginal);
        throw error;
      }
      if (anteriorAislado) await fs.rm(anteriorAislado, { force: true });

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

      await eliminarFotoPersistida(id_pozo, PUBLIC_DIR);
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
      const matches = await fs.readdir(PUBLIC_DIR);
      const fileName = matches.find((name) => name.startsWith(`pozo-${id_pozo}.`));
      if (!fileName) throw new err.T05PozoNoEncontrado();
      const extension = path.extname(fileName).toLowerCase();
      const contentType = extension === ".png" ? "image/png" : "image/jpeg";
      return rep.type(contentType).send(await fs.readFile(path.join(PUBLIC_DIR, fileName)));
    }
  );
};
export default pozoRoutes;
