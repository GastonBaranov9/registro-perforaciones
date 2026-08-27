import { type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { registrarConexionWebsocket, type WebsocketSocket } from "../plugins/websocket.ts";
import type { FastifyInstance } from "fastify";
import { isAdmin } from "../services/roles-services.ts";
const websocketRoute = async function (fastify: FastifyInstance) {
  fastify.get(
    "/ws",
    {
      websocket: true,
      schema: {
        tags: ["websocket"],
        summary: "Iniciar la conexion con WS",
        description:
          "Ruta autenticada para iniciar la conexion con WS",
      },
      onRequest: [fastify.authenticateWeb],
    },
    async (socket, req) => {
      const { sub: id_usuario } = req.user;
      registrarConexionWebsocket({
        id_usuario,
        socket: socket as WebsocketSocket,
        isAdmin: await isAdmin(id_usuario),
      });
      socket.send(
        JSON.stringify({
          mensaje: "Conectado al servidor",
          id_usuario,
        })
      );
      // Las notificaciones son exclusivamente de servidor a cliente. No se
      // aceptan IDs aportados por mensajes del navegador.
    }
  );
};

export default websocketRoute;
