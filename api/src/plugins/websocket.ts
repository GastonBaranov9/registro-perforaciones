import fastifyPlugin from "fastify-plugin";
import fastifyWebsocket from "@fastify/websocket";


export const clientConnections: {
  id_usuario?: number;
  isAdmin?: boolean;
  socket: any;
}[] = [];

export default fastifyPlugin(async function (fastify) {
  fastify.register(fastifyWebsocket, {
  });

  fastify.decorate(
    "notifyClient",
     function (id_usuario: number, data: any) {
      const socketUser = clientConnections.find((u) => u.id_usuario === id_usuario);
      if (!socketUser) return;

      const socket = socketUser.socket
      if (!socket) return;

      const message = JSON.stringify({ data });

      socket.send(message);
    }
  );
    fastify.decorate(
    "notifyAdmin",
    function (data: any) {
      clientConnections.forEach((connection) => {
        if (connection.isAdmin && connection.id_usuario !== undefined) {
          fastify.notifyClient(connection.id_usuario, data);
        }
      })
    }
  );

  fastify.decorate("notifyAll",
    function (data:any){
      clientConnections.forEach((connection) => {
        if (connection.id_usuario !== undefined) fastify.notifyClient(connection.id_usuario, data)
      })
    }
  )


  
});

declare module "fastify" {
  interface FastifyInstance {
    notifyClient(id_usuario: number, messageData: any): void;
    notifyAdmin(messageData: any): void;
    notifyAll(messageData: any): void;
  }
}
