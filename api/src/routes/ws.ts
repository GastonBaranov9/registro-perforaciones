import { type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { Usuario } from "../models/schemas.ts";
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
        querystring: Type.Pick(Usuario, ["id_usuario"]),
        description:
          "Ruta para iniciar la conexion con WS. No hay requerimientos de uso",
      },
    },
    async (socket, req) => {
      const { id_usuario } = req.query as {
        id_usuario: number;
      };
      clientConnections.push({
        id_usuario,
        socket: socket,
        isAdmin: await isAdmin(id_usuario),
      });
      socket.send(
        JSON.stringify({
          mensaje: "Conectado al servidor",
          id_usuario: id_usuario,
        })
      );

      socket.on("close", () => {
        clientConnections.splice(id_usuario, 1);
      });

      socket.on("message", (msg) => {
        const wsParseado = JSON.parse(msg);
        if (wsParseado) {
          switch (wsParseado.type) {
            case "Usuario editado":
              fastify.notifyClient(wsParseado.id_usuario, {
                type: "Usuario editado",
              });
              fastify.notifyAdmin({ type: "Usuario editado" });

              break;
            case "pozo":
              fastify.notifyClient(wsParseado.id_usuario, {
                type: "pozo",
              });
            case "editpozo":
              fastify.notifyClient(wsParseado.id_usuario, {
                type: "editpozo",
              });

            case "deletepozo":
                    fastify.notifyClient(wsParseado.id_usuario, {
                type: "deletepozo",
              });
          }
        }
      });
    }
  );
};

export default websocketRoute;
