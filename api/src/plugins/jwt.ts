import fastifyJwt from "@fastify/jwt";
import fastifyPlugin from "fastify-plugin";
import * as err from "../models/errors.ts";
import { getEstadoSesionUsuario, rolUser } from "../services/auth-services.ts";
import { myPool } from "../db/pool.ts";

export function normalizarEnteroPositivoSeguro(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  return null;
}

export function sesionVigente(
  estado: { activo: boolean; version_sesion: number } | null,
  versionToken: number
): boolean {
  return Boolean(
    estado && estado.activo && estado.version_sesion === versionToken
  );
}

export default fastifyPlugin(async function (fastify) {
  const secret = process.env.FASTIFY_SECRET;
  if (!secret) throw new err.T05ErrorDesconocido("Falta setear FASTIFY_SECRET");

  await fastify.register(fastifyJwt, { secret });
  const authenticatedRequests = new WeakMap<object, { idUsuario: number }>();

  fastify.decorate("authenticate", async function (req, rep) {
    if (authenticatedRequests.has(req)) return;

    try {
      await req.jwtVerify();
    } catch {
      throw new err.T05NoAutorizado();
    }

    const { sub, version_sesion } = req.user as {
      sub: unknown;
      version_sesion: unknown;
    };
    const idUsuario = normalizarEnteroPositivoSeguro(sub);
    const versionToken = normalizarEnteroPositivoSeguro(version_sesion);

    if (idUsuario === null || versionToken === null) {
      throw new err.T05NoAutorizado();
    }

    const estado = await getEstadoSesionUsuario(idUsuario);
    if (!sesionVigente(estado, versionToken)) {
      throw new err.T05NoAutorizado();
    }

    authenticatedRequests.set(req, { idUsuario });
  });
  fastify.decorate("userIsAdmin", async function (req, rep) {
    await fastify.authenticate(req, rep);
    const { sub } = req.user as { sub: number };
    const ok = await rolUser(sub, "administracion");
    if (!ok) throw new err.T05SinPermiso();
  });
  fastify.decorate("userIsPerforador", async function (req, rep) {
    await (fastify as any).authenticate(req, rep);
    const { sub } = req.user as { sub: number };
    const ok = await rolUser(sub, "perforador");
    if (!ok) throw new err.T05SinPermiso();
  });
  fastify.decorate("userIsPropietario", async function (req, rep) {
    await (fastify as any).authenticate(req, rep);
    const { sub } = req.user as { sub: number };
    const ok = await rolUser(sub, "propietario");
    if (!ok) throw new err.T05SinPermiso();
  });
  fastify.decorate(
    "userIsPropietarioOrPerforador",
    async function (req: any, rep: any) {
      await (fastify as any).authenticate(req, rep);
      const { sub } = req.user as { sub: number };
      const isPropietario = await rolUser(sub, "propietario");
      const IsPerforador = await rolUser(sub, "perforador");
      if (!(isPropietario || IsPerforador)) throw new err.T05SinPermiso();
    }
  );

    fastify.decorate(
    "userIsPropietarioOrPerforadorOrAdmin",
    async function (req: any, rep: any) {
      await (fastify as any).authenticate(req, rep);
      const { sub } = req.user as { sub: number };
      const isPropietario = await rolUser(sub, "propietario");
      const IsPerforador = await rolUser(sub, "perforador");
       const IsAdmin = await rolUser(sub, "administracion");
      if (!(isPropietario || IsPerforador || IsAdmin)) throw new err.T05SinPermiso();
    }
  );
  fastify.decorate(
    "userIsAdminOrPerforador",
    async function (req: any, rep: any) {
      await (fastify as any).authenticate(req, rep);
      const { sub } = req.user as { sub: number };
      const isAdmin = await rolUser(sub, "administracion");
      const IsPerforador = await rolUser(sub, "perforador");
      if (!(isAdmin || IsPerforador)) throw new err.T05SinPermiso();
    }
  );
  fastify.decorate("pozoIsFromUser", async function (req: any, rep: any) {
    await (fastify as any).authenticate(req, rep);
    const { sub } = req.user as { sub: number };
    const { id_pozo } = req.params as { id_pozo: number };
    const isAdmin = await rolUser(sub, "administracion");
    const { rows } = await myPool.query(
      `SELECT id_propietario, id_perforador FROM pozo WHERE id_pozo = $1`,
      [id_pozo]
    );
    if (rows.length === 0) throw new err.T05PozoNoEncontrado();
    const { id_propietario, id_perforador } = rows[0];
    if (
      Number(sub) !== Number(id_propietario) &&
      Number(sub) !== Number(id_perforador) &&
      !isAdmin
    )
      throw new err.T05SinPermiso();
  });

  fastify.decorate("IsThisUser", async function (req: any, rep: any) {
    await (fastify as any).authenticate(req, rep);
    const { sub } = req.user as { sub: number };
    const { id_usuario } = req.params as { id_usuario: number };
    console.log(id_usuario,Number(sub) )
    const isuser= Number(sub) === id_usuario;
    const isadmin =  await rolUser(sub, "administracion");

    if (!isuser && !isadmin ) throw new err.T05SinPermiso();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
    userIsAdmin: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
    userIsPerforador: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
    userIsPropietario: (
      req: FastifyRequest,
      rep: FastifyReply
    ) => Promise<void>;
    pozoIsFromUser: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
    userIsPropietarioOrPerforador: (
      req: FastifyRequest,
      rep: FastifyReply
    ) => Promise<void>;
    IsThisUser: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
    userIsAdminOrPerforador: (
      req: FastifyRequest,
      rep: FastifyReply
    ) => Promise<void>;

      userIsPropietarioOrPerforadorOrAdmin: (
      req: FastifyRequest,
      rep: FastifyReply
    ) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: number; version_sesion: number; roles?: {
      id_rol: number,
      nombre: string,
      descr: string
    }[] };
    user: { sub: number; version_sesion: number; roles?: {
      id_rol: number,
      nombre: string,
      descr: string
    }[] };
  }
}
