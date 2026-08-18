import fastifyPlugin from "fastify-plugin";
import fastifyWebsocket from "@fastify/websocket";

export const WS_HEARTBEAT_INTERVAL_MS = 30_000;
const WEBSOCKET_OPEN = 1;

export interface WebsocketSocket {
  readyState: number;
  send(data: string): void;
  ping(): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "close" | "pong", listener: () => void): void;
}

export interface ClientConnection {
  id_usuario?: number;
  isAdmin?: boolean;
  socket: WebsocketSocket;
  isAlive: boolean;
}

export const clientConnections: ClientConnection[] = [];

function retirarConexion(connection: ClientConnection, conexiones: ClientConnection[]): void {
  const index = conexiones.indexOf(connection);
  if (index >= 0) conexiones.splice(index, 1);
}

export function registrarConexionWebsocket(
  datos: Omit<ClientConnection, "isAlive">,
  conexiones: ClientConnection[] = clientConnections,
): ClientConnection {
  const connection: ClientConnection = { ...datos, isAlive: true };
  conexiones.push(connection);
  connection.socket.on("pong", () => { connection.isAlive = true; });
  connection.socket.on("close", () => retirarConexion(connection, conexiones));
  return connection;
}

export function ejecutarHeartbeatWebsocket(conexiones: ClientConnection[] = clientConnections): void {
  for (const connection of [...conexiones]) {
    if (!connection.isAlive || connection.socket.readyState !== WEBSOCKET_OPEN) {
      retirarConexion(connection, conexiones);
      try { connection.socket.terminate(); } catch { /* la conexión ya está muerta */ }
      continue;
    }
    connection.isAlive = false;
    try { connection.socket.ping(); }
    catch {
      retirarConexion(connection, conexiones);
      try { connection.socket.terminate(); } catch { /* la conexión ya está muerta */ }
    }
  }
}

export class WebsocketHeartbeat {
  private timer?: NodeJS.Timeout;
  private readonly conexiones: ClientConnection[];
  private readonly intervaloMs: number;

  constructor(
    conexiones: ClientConnection[] = clientConnections,
    intervaloMs = WS_HEARTBEAT_INTERVAL_MS,
  ) {
    this.conexiones = conexiones;
    this.intervaloMs = intervaloMs;
  }

  get active(): boolean { return this.timer !== undefined; }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => ejecutarHeartbeatWebsocket(this.conexiones), this.intervaloMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

export default fastifyPlugin(async function websocketPlugin(fastify) {
  await fastify.register(fastifyWebsocket);
  const heartbeat = new WebsocketHeartbeat();
  fastify.addHook("onReady", async () => heartbeat.start());
  fastify.addHook("onClose", async () => {
    heartbeat.stop();
    for (const connection of clientConnections.splice(0)) {
      try { connection.socket.close(1001, "Servidor cerrando"); } catch { /* cierre best effort */ }
    }
  });

  fastify.decorate("notifyClient", function (id_usuario: number, data: unknown) {
    const connection = clientConnections.find((candidate) => candidate.id_usuario === id_usuario);
    if (!connection || connection.socket.readyState !== WEBSOCKET_OPEN) return;
    connection.socket.send(JSON.stringify({ data }));
  });

  fastify.decorate("notifyAdmin", function (data: unknown) {
    clientConnections.forEach((connection) => {
      if (connection.isAdmin && connection.id_usuario !== undefined)
        fastify.notifyClient(connection.id_usuario, data);
    });
  });

  fastify.decorate("notifyAll", function (data: unknown) {
    clientConnections.forEach((connection) => {
      if (connection.id_usuario !== undefined) fastify.notifyClient(connection.id_usuario, data);
    });
  });
});

declare module "fastify" {
  interface FastifyInstance {
    notifyClient(id_usuario: number, messageData: unknown): void;
    notifyAdmin(messageData: unknown): void;
    notifyAll(messageData: unknown): void;
  }
}
