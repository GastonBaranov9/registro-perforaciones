import fastifyJwt from "@fastify/jwt";
import fastifyPlugin from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import * as err from "../models/errors.ts";
import { getEstadoSesionUsuario, rolUser } from "../services/auth-services.ts";
import { SESSION_COOKIE } from "./cookies.ts";
import { pozoPerteneceAPerforador, pozoPerteneceAUsuario } from "../services/autorizacion-recursos.ts";
import { cargarConfiguracionRuntime } from "../config/runtime.ts";
import type { NativePlatform } from "../services/native-auth-service.ts";
import {
  resolverSesionNative,
  type NativeClientMetadata,
} from "../services/native-auth-service.ts";
import { extraerBearerNativo } from "../services/native-token-service.ts";

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

export function normalizarExpJwt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export function normalizarClaimsWeb(payload: {
  sub?: unknown;
  version_sesion?: unknown;
  exp?: unknown;
}): { idUsuario: number; versionToken: number; expiresAtSeconds: number } | null {
  const idUsuario = normalizarEnteroPositivoSeguro(payload.sub);
  const versionToken = normalizarEnteroPositivoSeguro(payload.version_sesion);
  const expiresAtSeconds = normalizarExpJwt(payload.exp);
  return idUsuario === null || versionToken === null || expiresAtSeconds === null
    ? null
    : { idUsuario, versionToken, expiresAtSeconds };
}

export function leerMetadataNative(
  headers: { [key: string]: unknown },
): NativeClientMetadata | null {
  const platform = headers["x-native-platform"];
  const buildRaw = headers["x-native-app-build"];
  const appVersion = headers["x-native-app-version"];
  if (
    (platform !== "android" && platform !== "ios") ||
    typeof buildRaw !== "string" ||
    !/^[1-9]\d*$/.test(buildRaw)
  ) return null;
  const appBuild = Number(buildRaw);
  if (!Number.isSafeInteger(appBuild) || appBuild > 2_147_483_647) return null;
  if (
    appVersion !== undefined &&
    (typeof appVersion !== "string" || appVersion.length === 0 || appVersion.length > 80)
  ) return null;
  return {
    platform,
    appBuild,
    ...(typeof appVersion === "string" ? { appVersion } : {}),
  };
}

export function buildMinimoNative(
  platform: NativePlatform,
  config: ReturnType<typeof cargarConfiguracionRuntime>,
): number {
  return platform === "android"
    ? config.nativeAuth.minAndroidBuild
    : config.nativeAuth.minIosBuild;
}

export default fastifyPlugin(async function (fastify) {
  const config = cargarConfiguracionRuntime();
  const secret = config.fastifySecret;
  if (!secret) throw new err.T05ErrorDesconocido("Falta setear FASTIFY_SECRET");

  await fastify.register(fastifyJwt, {
    secret,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
  });
  const authenticatedRequests = new WeakMap<object, { idUsuario: number }>();

  fastify.decorateRequest("authMechanism", null);
  fastify.decorateRequest("nativeAuth", null);

  const authenticateWeb = async function (req: FastifyRequest): Promise<void> {
    if (authenticatedRequests.has(req) && req.authMechanism === "web-cookie") return;
    if (req.headers.authorization !== undefined) throw new err.T05NoAutorizado();

    try {
      await req.jwtVerify({ onlyCookie: true });
    } catch {
      throw new err.T05NoAutorizado();
    }

    const claims = normalizarClaimsWeb(req.user);
    if (!claims) throw new err.T05NoAutorizado();
    const { idUsuario, versionToken } = claims;

    const estado = await getEstadoSesionUsuario(idUsuario);
    if (!sesionVigente(estado, versionToken)) {
      throw new err.T05NoAutorizado();
    }

    req.authMechanism = "web-cookie";
    authenticatedRequests.set(req, { idUsuario });
  };

  const authenticateNative = async function (
    req: FastifyRequest,
    enforceMinimum: boolean,
  ): Promise<void> {
    if (authenticatedRequests.has(req) && req.authMechanism === "native-bearer") {
      if (
        enforceMinimum &&
        req.nativeAuth &&
        req.nativeAuth.metadata.appBuild < buildMinimoNative(req.nativeAuth.metadata.platform, config)
      ) throw new err.T05ActualizacionNativeRequerida();
      return;
    }
    if (req.cookies[SESSION_COOKIE]) throw new err.T05NoAutorizado();
    const rawToken = extraerBearerNativo(req.headers.authorization);
    if (!rawToken) throw new err.T05NoAutorizado();
    const session = await resolverSesionNative(rawToken, config);
    if (!session) throw new err.T05NoAutorizado();
    const metadata = leerMetadataNative(req.headers);
    if (!metadata || metadata.platform !== session.platform) {
      throw new err.T05MetadataNativeInvalida();
    }
    if (
      enforceMinimum &&
      metadata.appBuild < buildMinimoNative(metadata.platform, config)
    ) throw new err.T05ActualizacionNativeRequerida();

    req.user = {
      sub: session.idUsuario,
      version_sesion: session.versionSesionEmitida,
    };
    req.authMechanism = "native-bearer";
    req.nativeAuth = { session, metadata };
    authenticatedRequests.set(req, { idUsuario: session.idUsuario });
  };

  fastify.decorate("authenticateWeb", async function (req) {
    await authenticateWeb(req);
  });
  fastify.decorate("authenticateNative", async function (req) {
    await authenticateNative(req, true);
  });
  fastify.decorate("authenticateNativeAllowObsolete", async function (req) {
    await authenticateNative(req, false);
  });
  fastify.decorate("authenticate", async function (req) {
    if (req.headers.authorization !== undefined) {
      await authenticateNative(req, true);
      return;
    }
    await authenticateWeb(req);
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
    if (await rolUser(sub, "administracion")) return;
    if (await rolUser(sub, "propietario")) {
      if (!(await pozoPerteneceAUsuario(id_pozo, sub))) throw new err.T05PozoNoEncontrado();
      return;
    }
    if (await rolUser(sub, "perforador")) {
      if (!(await pozoPerteneceAPerforador(id_pozo, sub))) throw new err.T05PozoNoEncontrado();
      return;
    }
    throw new err.T05SinPermiso();
  });

  fastify.decorate("IsThisUser", async function (req: any, rep: any) {
    await (fastify as any).authenticate(req, rep);
    const { sub } = req.user as { sub: number };
    const { id_usuario } = req.params as { id_usuario: number };
    const isuser= Number(sub) === id_usuario;
    const isadmin =  await rolUser(sub, "administracion");

    if (!isuser && !isadmin ) throw new err.T05SinPermiso();
  });
});

declare module "fastify" {
  interface FastifyRequest {
    authMechanism: "web-cookie" | "native-bearer" | null;
    nativeAuth: {
      session: import("../services/native-auth-service.ts").NativeSessionIdentity;
      metadata: import("../services/native-auth-service.ts").NativeClientMetadata;
    } | null;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
    authenticateWeb: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
    authenticateNative: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
    authenticateNativeAllowObsolete: (
      req: FastifyRequest,
      rep: FastifyReply,
    ) => Promise<void>;
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
    payload: { sub: number; version_sesion: number; exp?: number; roles?: {
      id_rol: number,
      nombre: string,
      descr: string
    }[] };
    user: { sub: number; version_sesion: number; exp?: number; roles?: {
      id_rol: number,
      nombre: string,
      descr: string
    }[] };
  }
}
