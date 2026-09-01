import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { cargarConfiguracionRuntime } from "../src/config/runtime.ts";
import { myPool } from "../src/db/pool.ts";
import {
  crearSesionNative,
  consumirTicketWsNative,
  emitirTicketWsNative,
  resolverSesionNative,
  revocarSesionNativePorToken,
  validarSesionNativeParaWebsocket,
  type NativeSessionIssued,
} from "../src/services/native-auth-service.ts";
import { generarTokenNativo, hmacTokenNativo } from "../src/services/native-token-service.ts";
import { hashPassword } from "../src/services/password-service.ts";
import {
  clientConnections,
  registrarConexionWebsocket,
  validarConexionWebsocket,
  type WebsocketSocket,
} from "../src/plugins/websocket.ts";

const PASSWORD = "NativeWsLockOrder123!";
const METADATA = { platform: "android" as const, appBuild: 10, appVersion: "1.0.0" };
const REDEMPTION_LOCK_MARKER = "native-ws-ticket-user-lock";
const LOGIN_LOCK_MARKER = "native-login-user-lock";
const LOGOUT_LOCK_MARKER = "native-logout-user-lock";

class ControlledSocket implements WebsocketSocket {
  readyState = 1;
  closes = 0;
  private listeners = new Map<string, Array<() => void>>();

  send(): void {}
  ping(): void {}
  close(): void {
    this.closes += 1;
    this.readyState = 3;
    for (const listener of this.listeners.get("close") ?? []) listener();
  }
  terminate(): void { this.close(); }
  on(event: "close" | "pong", listener: () => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 7_000): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timeout sin progreso: ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function createUser(label: string, passwordHash: string): Promise<{ id: number; email: string }> {
  const email = `rsp09d-r6-${label}-${randomUUID()}@example.test`;
  const { rows } = await myPool.query<{ id_usuario: string }>(
    `INSERT INTO usuario(email,nombre,password,activo,cuenta_acceso)
     VALUES($1,$2,$3,TRUE,TRUE)
     RETURNING id_usuario`,
    [email, label, passwordHash],
  );
  return { id: Number(rows[0].id_usuario), email };
}

async function seedSession(
  idUsuario: number,
  config: ReturnType<typeof cargarConfiguracionRuntime>,
  installationId = randomUUID(),
  createdMinutesAgo = 0,
): Promise<NativeSessionIssued> {
  const token = generarTokenNativo("session");
  const { rows } = await myPool.query<{
    id_sesion_nativa: string;
    expires_at: Date;
  }>(
    `INSERT INTO sesion_nativa(
       id_usuario,token_hash,installation_id,version_sesion_emitida,
       platform,app_build_at_login,app_version_at_login,created_at,expires_at
     ) VALUES(
       $1,$2,$3,1,'android',10,'1.0.0',
       now()-make_interval(mins => $4),now()+interval '30 days'
     ) RETURNING id_sesion_nativa,expires_at`,
    [
      idUsuario,
      hmacTokenNativo(token, config.nativeAuth.hmacSecret, "session"),
      installationId,
      createdMinutesAgo,
    ],
  );
  return {
    token,
    idSesionNativa: Number(rows[0].id_sesion_nativa),
    idUsuario,
    versionSesionEmitida: 1,
    platform: "android",
    expiresAt: rows[0].expires_at,
  };
}

async function issueTicket(
  session: NativeSessionIssued,
  config: ReturnType<typeof cargarConfiguracionRuntime>,
): Promise<string> {
  return (await emitirTicketWsNative(session, METADATA, config)).ticket;
}

async function waitUntilBlocked(marker: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await myPool.query<{ cantidad: string }>(
      `SELECT count(*) AS cantidad
         FROM pg_stat_activity
        WHERE datname=current_database()
          AND pid<>pg_backend_pid()
          AND state='active'
          AND wait_event_type='Lock'
          AND query LIKE $1`,
      [`%${marker}%`],
    );
    if (Number(rows[0].cantidad) > 0) return;
    await delay(10);
  }
  throw new Error(`La operacion ${marker} no alcanzo el lock esperado`);
}

async function runQueuedByUser<TFirst, TSecond>(
  idUsuario: number,
  firstMarker: string,
  first: () => Promise<TFirst>,
  secondMarker: string,
  second: () => Promise<TSecond>,
  label: string,
): Promise<[TFirst, TSecond]> {
  const barrier = await myPool.connect();
  let committed = false;
  let firstPromise: Promise<TFirst> | undefined;
  let secondPromise: Promise<TSecond> | undefined;
  try {
    await barrier.query("BEGIN");
    await barrier.query(
      "SELECT id_usuario FROM usuario WHERE id_usuario=$1 FOR UPDATE",
      [idUsuario],
    );
    firstPromise = first();
    await waitUntilBlocked(firstMarker);
    secondPromise = second();
    await waitUntilBlocked(secondMarker);
    await barrier.query("COMMIT");
    committed = true;
    return await withTimeout(Promise.all([firstPromise, secondPromise]), label);
  } finally {
    if (!committed) {
      await barrier.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled([firstPromise, secondPromise].filter(Boolean));
    }
    barrier.release(!committed);
  }
}

async function activeCount(idUsuario: number): Promise<number> {
  const { rows } = await myPool.query<{ cantidad: string }>(
    `SELECT count(*) AS cantidad
       FROM sesion_nativa AS s
       JOIN usuario AS u ON u.id_usuario=s.id_usuario
      WHERE s.id_usuario=$1
        AND s.revoked_at IS NULL
        AND s.expires_at>now()
        AND s.version_sesion_emitida=u.version_sesion`,
    [idUsuario],
  );
  return Number(rows[0].cantidad);
}

test("RSP-09D-R6 serializa redemption, logout, replacement y eviction en PostgreSQL real", async () => {
  const config = cargarConfiguracionRuntime();
  const passwordHash = await hashPassword(PASSWORD);

  try {
    const normalUser = await createUser("normal", passwordHash);
    const normalSession = await seedSession(normalUser.id, config);
    const normalTicket = await issueTicket(normalSession, config);
    const normalIdentity = await consumirTicketWsNative(normalTicket, config);
    assert.equal(normalIdentity?.idSesionNativa, normalSession.idSesionNativa);
    assert.equal(await consumirTicketWsNative(normalTicket, config), null, "ticket usado no se reutiliza");

    const singleUseTicket = await issueTicket(normalSession, config);
    const singleUseResults = await withTimeout(Promise.all([
      consumirTicketWsNative(singleUseTicket, config),
      consumirTicketWsNative(singleUseTicket, config),
    ]), "dos redenciones del mismo ticket");
    assert.equal(singleUseResults.filter(Boolean).length, 1, "exactamente una redencion gana");

    const logoutUser = await createUser("logout", passwordHash);
    const logoutSession = await seedSession(logoutUser.id, config);
    const logoutTicket = await issueTicket(logoutSession, config);
    const [redeemedBeforeLogout, logoutAfterRedemption] = await runQueuedByUser(
      logoutUser.id,
      REDEMPTION_LOCK_MARKER,
      () => consumirTicketWsNative(logoutTicket, config),
      LOGOUT_LOCK_MARKER,
      () => revocarSesionNativePorToken(logoutSession.token, config),
      "redemption vs logout-device",
    );
    assert.notEqual(redeemedBeforeLogout, null);
    assert.equal(logoutAfterRedemption, true);
    assert.equal(await resolverSesionNative(logoutSession.token, config), null);

    const candidateSocket = new ControlledSocket();
    const candidate = registrarConexionWebsocket({
      id_usuario: logoutUser.id,
      socket: candidateSocket,
      operational: false,
      auth: {
        kind: "native",
        versionSesion: redeemedBeforeLogout!.versionSesionEmitida,
        nativeSessionId: redeemedBeforeLogout!.idSesionNativa,
        nativePlatform: redeemedBeforeLogout!.platform,
        nativeAppBuild: redeemedBeforeLogout!.appBuildEmitido,
      },
      revalidate: () => validarSesionNativeParaWebsocket(redeemedBeforeLogout!, config),
    });
    assert.equal(await validarConexionWebsocket(candidate, clientConnections), false);
    assert.equal(candidateSocket.closes, 1, "una sesion revocada no obtiene socket operativo");

    const logoutWinsUser = await createUser("logout-wins", passwordHash);
    const logoutWinsSession = await seedSession(logoutWinsUser.id, config);
    const logoutWinsTicket = await issueTicket(logoutWinsSession, config);
    const [logoutFirst, rejectedAfterLogout] = await runQueuedByUser(
      logoutWinsUser.id,
      LOGOUT_LOCK_MARKER,
      () => revocarSesionNativePorToken(logoutWinsSession.token, config),
      REDEMPTION_LOCK_MARKER,
      () => consumirTicketWsNative(logoutWinsTicket, config),
      "logout-device vs redemption",
    );
    assert.equal(logoutFirst, true);
    assert.equal(rejectedAfterLogout, null);
    const logoutWinsStored = await myPool.query<{ used_at: Date | null }>(
      "SELECT used_at FROM ticket_ws_nativo WHERE ticket_hash=$1",
      [hmacTokenNativo(logoutWinsTicket, config.nativeAuth.hmacSecret, "ws-ticket")],
    );
    assert.equal(logoutWinsStored.rows[0].used_at, null, "rechazo por revocacion no consume ticket");

    const replacementUser = await createUser("replacement", passwordHash);
    const sharedInstallation = randomUUID();
    const replacedSession = await seedSession(replacementUser.id, config, sharedInstallation);
    const replacementTicket = await issueTicket(replacedSession, config);
    const [replacement, rejectedAfterReplacement] = await runQueuedByUser(
      replacementUser.id,
      LOGIN_LOCK_MARKER,
      () => crearSesionNative({
        email: replacementUser.email,
        password: PASSWORD,
        installationId: sharedInstallation,
        ...METADATA,
      }, config),
      REDEMPTION_LOCK_MARKER,
      () => consumirTicketWsNative(replacementTicket, config),
      "same-installation replacement vs redemption",
    );
    assert.equal(rejectedAfterReplacement, null);
    assert.equal(await resolverSesionNative(replacedSession.token, config), null);
    assert.notEqual(await resolverSesionNative(replacement.token, config), null);
    assert.equal(await activeCount(replacementUser.id), 1);

    const evictionUser = await createUser("eviction", passwordHash);
    const evictionSessions: NativeSessionIssued[] = [];
    for (let index = 0; index < config.nativeAuth.maxActiveSessionsPerUser; index += 1) {
      evictionSessions.push(await seedSession(
        evictionUser.id,
        config,
        randomUUID(),
        config.nativeAuth.maxActiveSessionsPerUser - index,
      ));
    }
    const evictionTarget = evictionSessions[0];
    const evictionTicket = await issueTicket(evictionTarget, config);
    const evictionSocket = new ControlledSocket();
    registrarConexionWebsocket({
      id_usuario: evictionUser.id,
      socket: evictionSocket,
      auth: {
        kind: "native",
        versionSesion: 1,
        nativeSessionId: evictionTarget.idSesionNativa,
        nativePlatform: "android",
        nativeAppBuild: 10,
      },
    });
    const [newSession, rejectedAfterEviction] = await runQueuedByUser(
      evictionUser.id,
      LOGIN_LOCK_MARKER,
      () => crearSesionNative({
        email: evictionUser.email,
        password: PASSWORD,
        installationId: randomUUID(),
        ...METADATA,
      }, config),
      REDEMPTION_LOCK_MARKER,
      () => consumirTicketWsNative(evictionTicket, config),
      "session-limit eviction vs redemption",
    );
    assert.equal(rejectedAfterEviction, null);
    assert.equal(await activeCount(evictionUser.id), config.nativeAuth.maxActiveSessionsPerUser);
    assert.equal(await resolverSesionNative(evictionTarget.token, config), null);
    assert.notEqual(await resolverSesionNative(newSession.token, config), null);
    assert.equal(evictionSocket.closes, 1, "eviction cierra el WS despues de COMMIT");
    const evictionReason = await myPool.query<{ revocation_reason: string }>(
      "SELECT revocation_reason FROM sesion_nativa WHERE id_sesion_nativa=$1",
      [evictionTarget.idSesionNativa],
    );
    assert.equal(evictionReason.rows[0].revocation_reason, "session_limit_eviction");

    const isolatedA = await createUser("isolated-a", passwordHash);
    const isolatedB = await createUser("isolated-b", passwordHash);
    const isolatedSessionA = await seedSession(isolatedA.id, config);
    const isolatedSessionB = await seedSession(isolatedB.id, config);
    const isolatedTicketA = await issueTicket(isolatedSessionA, config);
    const isolatedTicketB = await issueTicket(isolatedSessionB, config);
    const barrier = await myPool.connect();
    let barrierCommitted = false;
    let blockedRedemption: Promise<Awaited<ReturnType<typeof consumirTicketWsNative>>> | undefined;
    try {
      await barrier.query("BEGIN");
      await barrier.query("SELECT id_usuario FROM usuario WHERE id_usuario=$1 FOR UPDATE", [isolatedA.id]);
      blockedRedemption = consumirTicketWsNative(isolatedTicketA, config);
      await waitUntilBlocked(REDEMPTION_LOCK_MARKER);
      const independent = await withTimeout(
        consumirTicketWsNative(isolatedTicketB, config),
        "usuario distinto no debe esperar",
        2_000,
      );
      assert.equal(independent?.idUsuario, isolatedB.id);
      await barrier.query("COMMIT");
      barrierCommitted = true;
      assert.equal((await withTimeout(blockedRedemption, "redemption liberada")).idUsuario, isolatedA.id);
    } finally {
      if (!barrierCommitted) {
        await barrier.query("ROLLBACK").catch(() => undefined);
        await Promise.allSettled([blockedRedemption].filter(Boolean));
      }
      barrier.release(!barrierCommitted);
    }

    const rollbackUser = await createUser("rollback", passwordHash);
    const rollbackSession = await seedSession(rollbackUser.id, config);
    const rollbackTicket = await issueTicket(rollbackSession, config);
    const rollbackHash = hmacTokenNativo(rollbackTicket, config.nativeAuth.hmacSecret, "ws-ticket");
    const rollbackClient = await myPool.connect();
    try {
      await rollbackClient.query("BEGIN");
      await rollbackClient.query(
        "SELECT id_usuario FROM usuario WHERE id_usuario=$1 FOR UPDATE",
        [rollbackUser.id],
      );
      await rollbackClient.query(
        "SELECT id_sesion_nativa FROM sesion_nativa WHERE id_sesion_nativa=$1 FOR UPDATE",
        [rollbackSession.idSesionNativa],
      );
      const claimed = await rollbackClient.query(
        `UPDATE ticket_ws_nativo
            SET used_at=now()
          WHERE ticket_hash=$1
            AND id_sesion_nativa=$2
            AND used_at IS NULL
            AND expires_at>now()
        RETURNING id_ticket_ws_nativo`,
        [rollbackHash, rollbackSession.idSesionNativa],
      );
      assert.equal(claimed.rowCount, 1, "el claim llego a modificar el ticket dentro de la transaccion");
      await rollbackClient.query("ROLLBACK");
    } finally {
      rollbackClient.release();
    }
    const afterRollback = await myPool.query<{ used_at: Date | null }>(
      "SELECT used_at FROM ticket_ws_nativo WHERE ticket_hash=$1",
      [rollbackHash],
    );
    assert.equal(afterRollback.rows[0].used_at, null, "ROLLBACK no deja el ticket consumido");
    assert.notEqual(await consumirTicketWsNative(rollbackTicket, config), null);
  } finally {
    for (const connection of [...clientConnections]) connection.socket.close();
    await myPool.end();
  }
});
