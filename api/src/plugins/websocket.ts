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

export type WebsocketConnectionKind = "web" | "native";

export interface WebsocketAuthContext {
  kind: WebsocketConnectionKind;
  versionSesion: number;
  nativeSessionId?: number;
  nativePlatform?: "android" | "ios";
  nativeAppBuild?: number;
}

export interface ClientConnection {
  id_usuario?: number;
  isAdmin?: boolean;
  socket: WebsocketSocket;
  isAlive: boolean;
  auth?: WebsocketAuthContext;
  operational?: boolean;
  revalidate?: () => Promise<boolean>;
  revalidationInFlight?: boolean;
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
  if (datos.auth?.kind === "native" && datos.auth.nativeSessionId !== undefined) {
    for (const previous of [...conexiones]) {
      if (
        previous.auth?.kind === "native" &&
        previous.auth.nativeSessionId === datos.auth.nativeSessionId
      ) {
        retirarConexion(previous, conexiones);
        try { previous.socket.close(4001, "Socket reemplazado"); } catch { /* best effort */ }
      }
    }
  }
  const connection: ClientConnection = { ...datos, isAlive: true };
  conexiones.push(connection);
  connection.socket.on("pong", () => { connection.isAlive = true; });
  connection.socket.on("close", () => retirarConexion(connection, conexiones));
  return connection;
}

export function activarConexionWebsocket(
  connection: ClientConnection,
  conexiones: ClientConnection[] = clientConnections,
): boolean {
  if (!conexiones.includes(connection)) return false;
  connection.operational = true;
  return true;
}

export async function validarYActivarConexionWebsocket(
  connection: ClientConnection,
  conexiones: ClientConnection[] = clientConnections,
): Promise<boolean> {
  if (!conexiones.includes(connection)) return false;
  try {
    if (connection.revalidate && !(await connection.revalidate())) {
      cerrarConexionWebsocket(connection, conexiones, 4003, "Sesion no autorizada");
      return false;
    }
    if (!conexiones.includes(connection)) return false;
    return activarConexionWebsocket(connection, conexiones);
  } catch {
    cerrarConexionWebsocket(connection, conexiones, 1011, "Error interno");
    return false;
  }
}

export function cerrarConexionesNativeSession(
  nativeSessionId: number,
  conexiones: ClientConnection[] = clientConnections,
): void {
  cerrarConexiones(
    (connection) =>
      connection.auth?.kind === "native" &&
      connection.auth.nativeSessionId === nativeSessionId,
    conexiones,
    4003,
    "Sesion no autorizada",
  );
}

export function cerrarConexionesUsuario(
  idUsuario: number,
  conexiones: ClientConnection[] = clientConnections,
): void {
  cerrarConexiones(
    (connection) => connection.id_usuario === idUsuario,
    conexiones,
    4003,
    "Sesion no autorizada",
  );
}

function cerrarConexiones(
  predicate: (connection: ClientConnection) => boolean,
  conexiones: ClientConnection[],
  code: number,
  reason: string,
): void {
  for (const connection of [...conexiones]) {
    if (!predicate(connection)) continue;
    cerrarConexionWebsocket(connection, conexiones, code, reason);
  }
}

export function cerrarConexionWebsocket(
  connection: ClientConnection,
  conexiones: ClientConnection[] = clientConnections,
  code = 4003,
  reason = "Sesion no autorizada",
): void {
  retirarConexion(connection, conexiones);
  try { connection.socket.close(code, reason); } catch { /* best effort */ }
}

export async function revalidarConexionesWebsocket(
  conexiones: ClientConnection[] = clientConnections,
): Promise<void> {
  await Promise.all([...conexiones].map(async (connection) => {
    if (!connection.revalidate || connection.revalidationInFlight) return;
    connection.revalidationInFlight = true;
    try {
      if (!(await connection.revalidate())) {
        cerrarConexionWebsocket(connection, conexiones);
      }
    } catch {
      cerrarConexionWebsocket(connection, conexiones, 1011, "Error interno");
    } finally {
      connection.revalidationInFlight = false;
    }
  }));
}

export function notificarConexionesUsuario(
  idUsuario: number,
  data: unknown,
  conexiones: ClientConnection[] = clientConnections,
): void {
  const payload = JSON.stringify({ data });
  for (const connection of conexiones) {
    if (connection.id_usuario !== idUsuario || connection.operational === false || connection.socket.readyState !== WEBSOCKET_OPEN) continue;
    try { connection.socket.send(payload); } catch { /* cierre concurrente */ }
  }
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
    this.timer = setInterval(() => {
      ejecutarHeartbeatWebsocket(this.conexiones);
      void revalidarConexionesWebsocket(this.conexiones);
    }, this.intervaloMs);
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
    notificarConexionesUsuario(id_usuario, data);
  });

  fastify.decorate("notifyAdmin", function (data: unknown) {
    const payload = JSON.stringify({ data });
    for (const connection of clientConnections) {
      if (connection.isAdmin && connection.operational !== false && connection.socket.readyState === WEBSOCKET_OPEN) {
        try { connection.socket.send(payload); } catch { /* cierre concurrente */ }
      }
    }
  });

  fastify.decorate("notifyAll", function (data: unknown) {
    const payload = JSON.stringify({ data });
    for (const connection of clientConnections) {
      if (connection.id_usuario !== undefined && connection.operational !== false && connection.socket.readyState === WEBSOCKET_OPEN) {
        try { connection.socket.send(payload); } catch { /* cierre concurrente */ }
      }
    }
  });

  fastify.decorate("closeNativeSessionConnections", (idSesionNativa: number) => {
    cerrarConexionesNativeSession(idSesionNativa);
  });
  fastify.decorate("closeUserConnections", (idUsuario: number) => {
    cerrarConexionesUsuario(idUsuario);
  });
});

declare module "fastify" {
  interface FastifyInstance {
    notifyClient(id_usuario: number, messageData: unknown): void;
    notifyAdmin(messageData: unknown): void;
    notifyAll(messageData: unknown): void;
    closeNativeSessionConnections(idSesionNativa: number): void;
    closeUserConnections(idUsuario: number): void;
  }
}
