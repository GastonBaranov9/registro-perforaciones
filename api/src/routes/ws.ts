import { type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { clientConnections } from "../plugins/websocket.ts";
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
      onRequest: [fastify.authenticate],
    },
    async (socket, req) => {
      const { sub: id_usuario } = req.user;
      clientConnections.push({
        id_usuario,
        socket: socket,
        isAdmin: await isAdmin(id_usuario),
      });
      socket.send(
        JSON.stringify({
          mensaje: "Conectado al servidor",
          id_usuario,
        })
      );

      socket.on("close", () => {
        const index = clientConnections.findIndex(
          (connection) => connection.id_usuario === id_usuario && connection.socket === socket
        );
        if (index >= 0) clientConnections.splice(index, 1);
      });

      // Las notificaciones son exclusivamente de servidor a cliente. No se
      // aceptan IDs aportados por mensajes del navegador.
    }
  );
};

export default websocketRoute;
