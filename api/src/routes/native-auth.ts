import type { FastifyInstance } from "fastify";
import { Type } from "@fastify/type-provider-typebox";
import { cargarConfiguracionRuntime } from "../config/runtime.ts";
import * as err from "../models/errors.ts";
import {
  NativeLoginBody,
  NativeSessionResponse,
  NativeUsuarioPublico,
  type NativeLoginBody as NativeLoginData,
} from "../models/schemas.ts";
import { SESSION_COOKIE } from "../plugins/cookies.ts";
import { buildMinimoNative, leerMetadataNative } from "../plugins/jwt.ts";
import {
  crearSesionNative,
  emitirTicketWsNative,
  revocarSesionNativePorToken,
} from "../services/native-auth-service.ts";
import { revocarSesionesUsuario } from "../services/auth-services.ts";
import { nativeAuthJanitorHealth } from "../services/native-auth-janitor.ts";
import { extraerBearerNativo } from "../services/native-token-service.ts";
import { getUsuarioById } from "../services/usuarios-service.ts";

const NativeHeaders = Type.Object({
  "x-native-platform": Type.Union([
    Type.Literal("android"),
    Type.Literal("ios"),
  ]),
  "x-native-app-build": Type.String({ pattern: "^[1-9]\\d*$" }),
  "x-native-app-version": Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
});

const NativeLoginResponse = Type.Object({
  token_type: Type.Literal("Bearer"),
  session_token: Type.String(),
  expires_at: Type.String({ format: "date-time" }),
  user: NativeUsuarioPublico,
});

const NativeWsTicketResponse = Type.Object({
  ticket: Type.String(),
  expires_at: Type.String({ format: "date-time" }),
});

async function usuarioNative(idUsuario: number) {
  const user = await getUsuarioById(idUsuario);
  if (!user || !user.activo) throw new err.T05NoAutorizado();
  return {
    id_usuario: user.id_usuario,
    nombre: user.nombre,
    roles: user.roles ?? [],
  };
}

export default async function nativeAuthRoutes(fastify: FastifyInstance) {
  const config = cargarConfiguracionRuntime();

  fastify.post(
    "/auth/native/login",
    {
      schema: {
        tags: ["login"],
        headers: NativeHeaders,
        body: NativeLoginBody,
        response: {
          200: NativeLoginResponse,
          400: err.ErrorSchema,
          401: err.ErrorSchema,
          426: err.ErrorSchema,
        },
      },
      onRequest: [fastify.rateLimitLogin],
    },
    async (req) => {
      const metadata = leerMetadataNative(req.headers);
      if (!metadata) throw new err.T05MetadataNativeInvalida();
      if (metadata.appBuild < buildMinimoNative(metadata.platform, config)) {
        throw new err.T05ActualizacionNativeRequerida();
      }
      const body = req.body as NativeLoginData;
      const session = await crearSesionNative({
        email: body.email,
        password: body.password,
        installationId: body.installation_id,
        ...metadata,
      }, config);
      return {
        token_type: "Bearer" as const,
        session_token: session.token,
        expires_at: session.expiresAt.toISOString(),
        user: await usuarioNative(session.idUsuario),
      };
    },
  );

  fastify.get(
    "/auth/native/session",
    {
      schema: {
        tags: ["login"],
        headers: NativeHeaders,
        response: { 200: NativeSessionResponse, 401: err.ErrorSchema, 426: err.ErrorSchema },
      },
      onRequest: [fastify.authenticateNative],
    },
    async (req) => ({
      user: await usuarioNative(req.user.sub),
      expires_at: req.nativeAuth!.session.expiresAt.toISOString(),
    }),
  );

  fastify.post(
    "/auth/native/logout",
    {
      schema: {
        tags: ["login"],
        response: { 204: Type.Null(), 401: err.ErrorSchema },
      },
    },
    async (req, reply) => {
      if (req.cookies[SESSION_COOKIE]) throw new err.T05NoAutorizado();
      const token = extraerBearerNativo(req.headers.authorization);
      if (!token) throw new err.T05NoAutorizado();
      await revocarSesionNativePorToken(token, config);
      return reply.code(204).send();
    },
  );

  fastify.post(
    "/auth/native/logout-all",
    {
      schema: {
        tags: ["login"],
        headers: NativeHeaders,
        response: { 204: Type.Null(), 400: err.ErrorSchema, 401: err.ErrorSchema },
      },
      onRequest: [fastify.authenticateNativeAllowObsolete],
    },
    async (req, reply) => {
      if (!(await revocarSesionesUsuario(req.user.sub))) {
        throw new err.T05NoAutorizado();
      }
      return reply.code(204).send();
    },
  );

  fastify.post(
    "/auth/native/ws-ticket",
    {
      schema: {
        tags: ["login"],
        headers: NativeHeaders,
        response: {
          200: NativeWsTicketResponse,
          400: err.ErrorSchema,
          401: err.ErrorSchema,
          426: err.ErrorSchema,
          503: err.ErrorSchema,
        },
      },
      onRequest: [fastify.authenticateNative, fastify.rateLimitNativeWsTicket],
    },
    async (req) => {
      if (!nativeAuthJanitorHealth.canEmitWsTickets()) {
        throw new err.T05JanitorNativeNoDisponible();
      }
      const issued = await emitirTicketWsNative(
        req.nativeAuth!.session,
        req.nativeAuth!.metadata,
        config,
      );
      return {
        ticket: issued.ticket,
        expires_at: issued.expiresAt.toISOString(),
      };
    },
  );
}
