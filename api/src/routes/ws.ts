import { registrarConexionWebsocket, type WebsocketSocket } from "../plugins/websocket.ts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isAdmin } from "../services/roles-services.ts";
import {
  consumirTicketWsNative,
  validarSesionNativeParaWebsocket,
} from "../services/native-auth-service.ts";
import { cargarConfiguracionRuntime } from "../config/runtime.ts";
import { getEstadoSesionUsuario } from "../services/auth-services.ts";
import { sesionVigente } from "../plugins/jwt.ts";
import * as err from "../models/errors.ts";

const WS_PATH = "/ws";

function queryTicket(req: FastifyRequest): string | null {
  try {
    return new URL(req.url, "https://websocket.invalid").searchParams.get("ticket");
  } catch {
    return null;
  }
}

function esHandshakeNative(req: FastifyRequest): boolean {
  return queryTicket(req) !== null;
}

function cerrarAuth(socket: WebsocketSocket): void {
  try { socket.close(4003, "Sesion no autorizada"); } catch { /* handshake ya cerrado */ }
}

const websocketRoute = async function (fastify: FastifyInstance) {
  const config = cargarConfiguracionRuntime();
  fastify.get(
    WS_PATH,
    {
      websocket: true,
      schema: {
        tags: ["websocket"],
        summary: "Iniciar la conexion con WS",
        description: "Ruta autenticada por cookie web o ticket native",
      },
      onRequest: [async (req, reply) => {
        if (!esHandshakeNative(req)) {
          await fastify.authenticateWeb(req, reply);
          return;
        }
        if (
          typeof req.headers.origin !== "string" ||
          !config.nativeCorsOrigins.includes(req.headers.origin)
        ) throw new err.T05CsrfInvalido();
        if (req.cookies.rsp_session || req.headers.authorization !== undefined) {
          throw new err.T05NoAutorizado();
        }
      }],
    },
    async (socket, req) => {
      const nativeTicket = queryTicket(req);
      if (nativeTicket !== null) {
        let identity: Awaited<ReturnType<typeof consumirTicketWsNative>>;
        try {
          identity = await consumirTicketWsNative(nativeTicket, config);
        } catch {
          try { socket.close(1011, "Error interno"); } catch { /* handshake ya cerrado */ }
          return;
        }
        if (!identity) {
          cerrarAuth(socket as WebsocketSocket);
          return;
        }
        const connection = registrarConexionWebsocket({
          id_usuario: identity.idUsuario,
          socket: socket as WebsocketSocket,
          isAdmin: await isAdmin(identity.idUsuario),
          auth: {
            kind: "native",
            versionSesion: identity.versionSesionEmitida,
            nativeSessionId: identity.idSesionNativa,
            nativePlatform: identity.platform,
            nativeAppBuild: identity.appBuildEmitido,
          },
          revalidate: () => validarSesionNativeParaWebsocket(identity, config),
        });
        if (connection.socket.readyState === 1) {
          connection.socket.send(JSON.stringify({ mensaje: "Conectado al servidor" }));
        }
        return;
      }

      const idUsuario = req.user.sub;
      const versionSesion = req.user.version_sesion;
      registrarConexionWebsocket({
        id_usuario: idUsuario,
        socket: socket as WebsocketSocket,
        isAdmin: await isAdmin(idUsuario),
        auth: { kind: "web", versionSesion },
        revalidate: async () => sesionVigente(
          await getEstadoSesionUsuario(idUsuario),
          versionSesion,
        ),
      });
      socket.send(JSON.stringify({ mensaje: "Conectado al servidor", id_usuario: idUsuario }));
      // Las notificaciones son exclusivamente de servidor a cliente.
    }
  );
};

export default websocketRoute;
