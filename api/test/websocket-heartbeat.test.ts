import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ejecutarHeartbeatWebsocket,
  activarConexionWebsocket,
  jwtWebsocketVigente,
  registrarConexionWebsocket,
  cerrarConexionesNativeSession,
  notificarConexionesUsuario,
  revalidarConexionesWebsocket,
  validarYActivarConexionWebsocket,
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
  closeCodes: Array<number | undefined> = [];
  sent: string[] = [];
  private listeners = new Map<string, Array<() => void>>();

  send(data: string): void { this.sent.push(data); }
  ping(): void { this.pings += 1; }
  close(code?: number): void { this.cierres += 1;this.closeCodes.push(code);this.emit("close"); }
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

test("la conexion native no entra en fan-out hasta validar y activar", async () => {
  const conexiones: ClientConnection[] = [];
  const socket = new SocketControlado();
  let liberar: ((valida: boolean) => void) | undefined;
  const validacion = new Promise<boolean>((resolve) => { liberar = resolve; });
  const connection = registrarConexionWebsocket({
    id_usuario: 7, socket, operational: false,
    auth: { kind: "native", versionSesion: 1, nativeSessionId: 12 },
    revalidate: () => validacion,
  }, conexiones);
  const activacion = validarYActivarConexionWebsocket(connection, conexiones);
  notificarConexionesUsuario(7, { type: "durante-validacion" }, conexiones);
  assert.equal(socket.sent.length, 0);
  liberar!(true);
  assert.equal(await activacion, true);
  notificarConexionesUsuario(7, { type: "despues-validacion" }, conexiones);
  assert.equal(socket.sent.length, 1);
  assert.equal(activarConexionWebsocket(connection, conexiones), true);
});

test("cierre concurrente con post-validacion es idempotente y no deja fantasma", async () => {
  const conexiones: ClientConnection[] = [];
  const socket = new SocketControlado();
  let liberar: (() => void) | undefined;
  const validacion = new Promise<boolean>((resolve) => { liberar = () => resolve(true); });
  const connection = registrarConexionWebsocket({
    id_usuario: 7, socket, operational: false,
    auth: { kind: "native", versionSesion: 1, nativeSessionId: 13 },
    revalidate: () => validacion,
  }, conexiones);
  const activacion = validarYActivarConexionWebsocket(connection, conexiones);
  cerrarConexionesNativeSession(13, conexiones);
  liberar!();
  assert.equal(await activacion, false);
  cerrarConexionesNativeSession(13, conexiones);
  assert.equal(conexiones.length, 0);
  assert.equal(socket.cierres, 1);
});

test("candidate conserva el active hasta promoverse y fan-out no tiene hueco", async () => {
  const conexiones: ClientConnection[] = [];
  const active = new SocketControlado();
  const candidate = new SocketControlado();
  registrarConexionWebsocket({
    id_usuario: 7, socket: active,
    auth: { kind: "native", versionSesion: 1, nativeSessionId: 20 },
  }, conexiones);
  let liberar: ((valid: boolean) => void) | undefined;
  const validation = new Promise<boolean>((resolve) => { liberar = resolve; });
  const pending = registrarConexionWebsocket({
    id_usuario: 7, socket: candidate, operational: false,
    auth: { kind: "native", versionSesion: 1, nativeSessionId: 20 },
    revalidate: () => validation,
  }, conexiones);
  const promotion = validarYActivarConexionWebsocket(pending, conexiones);
  notificarConexionesUsuario(7, { type: "durante-validacion" }, conexiones);
  assert.equal(active.sent.length, 1);
  assert.equal(candidate.sent.length, 0);
  assert.equal(active.cierres, 0);

  liberar!(true);
  assert.equal(await promotion, true);
  assert.equal(active.closeCodes.at(-1), 4001);
  notificarConexionesUsuario(7, { type: "despues-promocion" }, conexiones);
  assert.equal(active.sent.length, 1);
  assert.equal(candidate.sent.length, 1);
  active.emit("close");
  assert.equal(conexiones.length, 1);
  assert.equal(conexiones[0], pending);
});

test("candidate fallido o desconectado no elimina el active", async () => {
  for (const disconnected of [false, true]) {
    const conexiones: ClientConnection[] = [];
    const active = new SocketControlado();
    const candidate = new SocketControlado();
    registrarConexionWebsocket({
      id_usuario: 7, socket: active,
      auth: { kind: "native", versionSesion: 1, nativeSessionId: 21 },
    }, conexiones);
    const pending = registrarConexionWebsocket({
      id_usuario: 7, socket: candidate, operational: false,
      auth: { kind: "native", versionSesion: 1, nativeSessionId: 21 },
      revalidate: async () => false,
    }, conexiones);
    if (disconnected) candidate.emit("close");
    assert.equal(await validarYActivarConexionWebsocket(pending, conexiones), false);
    assert.equal(active.cierres, 0);
    notificarConexionesUsuario(7, { type: "activo" }, conexiones);
    assert.equal(active.sent.length, 1);
  }
});

test("logout durante candidate cierra ambos e impide promocion tardia", async () => {
  const conexiones: ClientConnection[] = [];
  const active = new SocketControlado();
  const candidate = new SocketControlado();
  registrarConexionWebsocket({
    id_usuario: 7, socket: active,
    auth: { kind: "native", versionSesion: 1, nativeSessionId: 22 },
  }, conexiones);
  let liberar: (() => void) | undefined;
  const validation = new Promise<boolean>((resolve) => { liberar = () => resolve(true); });
  const pending = registrarConexionWebsocket({
    id_usuario: 7, socket: candidate, operational: false,
    auth: { kind: "native", versionSesion: 1, nativeSessionId: 22 },
    revalidate: () => validation,
  }, conexiones);
  const promotion = validarYActivarConexionWebsocket(pending, conexiones);
  cerrarConexionesNativeSession(22, conexiones);
  liberar!();
  assert.equal(await promotion, false);
  assert.equal(active.cierres, 1);
  assert.equal(candidate.cierres, 1);
  assert.equal(conexiones.length, 0);
});

test("un candidate nuevo reemplaza deterministamente al pendiente, no al active", async () => {
  const conexiones: ClientConnection[] = [];
  const active = new SocketControlado();
  const firstCandidate = new SocketControlado();
  const secondCandidate = new SocketControlado();
  registrarConexionWebsocket({
    id_usuario: 7, socket: active,
    auth: { kind: "native", versionSesion: 1, nativeSessionId: 23 },
  }, conexiones);
  registrarConexionWebsocket({
    id_usuario: 7, socket: firstCandidate, operational: false,
    auth: { kind: "native", versionSesion: 1, nativeSessionId: 23 },
  }, conexiones);
  const newest = registrarConexionWebsocket({
    id_usuario: 7, socket: secondCandidate, operational: false,
    auth: { kind: "native", versionSesion: 1, nativeSessionId: 23 },
    revalidate: async () => true,
  }, conexiones);
  assert.equal(firstCandidate.closeCodes.at(-1), 4001);
  assert.equal(active.cierres, 0);
  assert.equal(await validarYActivarConexionWebsocket(newest, conexiones), true);
  assert.equal(active.closeCodes.at(-1), 4001);
  assert.equal(conexiones.length, 1);
  assert.equal(conexiones[0], newest);
});

test("exp web usa segundos Unix y cierra aun con estado DB valido", async () => {
  assert.equal(jwtWebsocketVigente(100, 99_999), true);
  assert.equal(jwtWebsocketVigente(100, 100_000), false);
  assert.equal(jwtWebsocketVigente(101, 100_999), true);
  assert.equal(jwtWebsocketVigente(Number.NaN, 0), false);
  assert.equal(jwtWebsocketVigente(0, 0), false);

  const conexiones: ClientConnection[] = [];
  const expiredBeforeFanout = new SocketControlado();
  registrarConexionWebsocket({
    id_usuario: 7, socket: expiredBeforeFanout,
    auth: { kind: "web", versionSesion: 1, webExpiresAtSeconds: 100 },
    revalidate: async () => true,
  }, conexiones);
  notificarConexionesUsuario(7, { type: "despues-exp" }, conexiones);
  assert.equal(expiredBeforeFanout.sent.length, 0);
  assert.equal(expiredBeforeFanout.cierres, 1);
  assert.equal(conexiones.length, 0);

  const expired = new SocketControlado();
  registrarConexionWebsocket({
    id_usuario: 7, socket: expired,
    auth: { kind: "web", versionSesion: 1, webExpiresAtSeconds: 100 },
    revalidate: async () => jwtWebsocketVigente(100, 100_000) && true,
  }, conexiones);
  await revalidarConexionesWebsocket(conexiones);
  assert.equal(expired.cierres, 1);
  assert.equal(conexiones.length, 0);

  const future = new SocketControlado();
  registrarConexionWebsocket({
    id_usuario: 7, socket: future,
    auth: { kind: "web", versionSesion: 1, webExpiresAtSeconds: 101 },
    revalidate: async () => jwtWebsocketVigente(101, 100_999) && true,
  }, conexiones);
  const native = new SocketControlado();
  registrarConexionWebsocket({
    id_usuario: 7, socket: native,
    auth: { kind: "native", versionSesion: 1, nativeSessionId: 24 },
    revalidate: async () => true,
  }, conexiones);
  await revalidarConexionesWebsocket(conexiones);
  assert.equal(future.cierres, 0);
  assert.equal(native.cierres, 0);
  assert.equal(conexiones.length, 2);
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
