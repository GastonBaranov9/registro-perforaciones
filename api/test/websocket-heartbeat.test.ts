import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ejecutarHeartbeatWebsocket,
  registrarConexionWebsocket,
  cerrarConexionesNativeSession,
  notificarConexionesUsuario,
  revalidarConexionesWebsocket,
  WebsocketHeartbeat,
  WS_HEARTBEAT_INTERVAL_MS,
  type ClientConnection,
  type WebsocketSocket,
} from "../src/plugins/websocket.ts";

class SocketControlado implements WebsocketSocket {
  readyState = 1;
  pings = 0;
  terminaciones = 0;
  cierres = 0;
  sent: string[] = [];
  private listeners = new Map<string, Array<() => void>>();

  send(data: string): void { this.sent.push(data); }
  ping(): void { this.pings += 1; }
  close(): void { this.cierres += 1;this.emit("close"); }
  terminate(): void { this.terminaciones += 1;this.emit("close"); }
  on(event: "close" | "pong", listener: () => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  emit(event: "close" | "pong"): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

test("heartbeat ping/pong mantiene una conexion inactiva mas de cinco minutos simulados", () => {
  const conexiones: ClientConnection[] = [];
  const socket = new SocketControlado();
  const connection = registrarConexionWebsocket({ id_usuario: 7, isAdmin: false, socket }, conexiones);
  const ciclos = Math.ceil(5 * 60_000 / WS_HEARTBEAT_INTERVAL_MS) + 1;
  for (let ciclo = 0; ciclo < ciclos; ciclo += 1) {
    ejecutarHeartbeatWebsocket(conexiones);
    assert.equal(connection.isAlive, false);
    socket.emit("pong");
    assert.equal(connection.isAlive, true);
  }
  assert.equal(socket.pings, ciclos);
  assert.equal(socket.terminaciones, 0);
  assert.equal(conexiones.length, 1);
});

test("heartbeat termina y retira un cliente que no responde pong", () => {
  const conexiones: ClientConnection[] = [];
  const socket = new SocketControlado();
  registrarConexionWebsocket({ id_usuario: 8, isAdmin: false, socket }, conexiones);
  ejecutarHeartbeatWebsocket(conexiones);
  assert.equal(socket.pings, 1);
  ejecutarHeartbeatWebsocket(conexiones);
  assert.equal(socket.terminaciones, 1);
  assert.equal(conexiones.length, 0);
});

test("registry reemplaza sólo el socket native de la misma sesión", () => {
  const conexiones: ClientConnection[] = [];
  const first = new SocketControlado();
  const second = new SocketControlado();
  const otherSession = new SocketControlado();
  registrarConexionWebsocket({
    id_usuario: 7, socket: first, auth: { kind: "native", versionSesion: 1, nativeSessionId: 10 },
  }, conexiones);
  registrarConexionWebsocket({
    id_usuario: 7, socket: otherSession, auth: { kind: "native", versionSesion: 1, nativeSessionId: 11 },
  }, conexiones);
  registrarConexionWebsocket({
    id_usuario: 7, socket: second, auth: { kind: "native", versionSesion: 1, nativeSessionId: 10 },
  }, conexiones);
  assert.equal(conexiones.length, 2);
  assert.equal(first.cierres, 1);
  assert.equal(conexiones.some((connection) => connection.socket === otherSession), true);
  assert.equal(conexiones.some((connection) => connection.socket === second), true);
});

test("registry permite fan-out a dos sesiones y limpia logout-device", () => {
  const conexiones: ClientConnection[] = [];
  const first = new SocketControlado();
  const second = new SocketControlado();
  registrarConexionWebsocket({
    id_usuario: 7, socket: first, auth: { kind: "native", versionSesion: 1, nativeSessionId: 10 },
  }, conexiones);
  registrarConexionWebsocket({
    id_usuario: 7, socket: second, auth: { kind: "native", versionSesion: 1, nativeSessionId: 11 },
  }, conexiones);
  notificarConexionesUsuario(7, { type: "pozo" }, conexiones);
  assert.equal(first.sent.length, 1);
  assert.equal(second.sent.length, 1);
  cerrarConexionesNativeSession(10, conexiones);
  assert.equal(conexiones.length, 1);
  assert.equal(first.cierres, 1);
  assert.equal(second.cierres, 0);
});

test("revalidación elimina una conexión native inválida", async () => {
  const conexiones: ClientConnection[] = [];
  const socket = new SocketControlado();
  registrarConexionWebsocket({
    id_usuario: 7, socket,
    auth: { kind: "native", versionSesion: 1, nativeSessionId: 10 },
    revalidate: async () => false,
  }, conexiones);
  await revalidarConexionesWebsocket(conexiones);
  assert.equal(conexiones.length, 0);
  assert.equal(socket.cierres, 1);
});

test("el controlador de heartbeat no duplica timers y los limpia", async () => {
  const conexiones: ClientConnection[] = [];
  const socket = new SocketControlado();
  registrarConexionWebsocket({ id_usuario: 9, isAdmin: false, socket }, conexiones);
  const heartbeat = new WebsocketHeartbeat(conexiones, 10);
  heartbeat.start();heartbeat.start();
  assert.equal(heartbeat.active, true);
  heartbeat.stop();
  assert.equal(heartbeat.active, false);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(socket.pings, 0);
});

test("proxy conserva upgrade y un timeout varias veces mayor al heartbeat", async () => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const proxy = await fs.readFile(path.join(repo, "proxy", "https.conf.template"), "utf8");
  const bloque = proxy.match(/location = \/ws \{[\s\S]*?\n    \}/)?.[0] ?? "";
  assert.match(bloque, /proxy_http_version 1\.1/);
  assert.match(bloque, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(bloque, /proxy_set_header Connection \$connection_upgrade/);
  const timeoutSeconds = Number(bloque.match(/proxy_read_timeout (\d+)s/)?.[1]);
  assert.ok(timeoutSeconds * 1_000 >= WS_HEARTBEAT_INTERVAL_MS * 4);
});
