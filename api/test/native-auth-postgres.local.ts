import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { cargarConfiguracionRuntime } from "../src/config/runtime.ts";
import { myPool } from "../src/db/pool.ts";
import cookies, { CSRF_COOKIE, SESSION_COOKIE } from "../src/plugins/cookies.ts";
import csrf from "../src/plugins/csrf.ts";
import errorHandler from "../src/plugins/error-handler.ts";
import jwt from "../src/plugins/jwt.ts";
import rateLimit from "../src/plugins/rate-limit.ts";
import nativeAuthRoutes from "../src/routes/native-auth.ts";
import { NativeAuthJanitor, registrarNativeAuthJanitor } from "../src/services/native-auth-janitor.ts";
import {
  crearSesionNative,
  consumirTicketWsNative,
  emitirTicketWsNative,
  resolverSesionNative,
  revocarSesionNativePorToken,
} from "../src/services/native-auth-service.ts";
import { generarTokenNativo, hmacTokenNativo } from "../src/services/native-token-service.ts";
import { hashPassword } from "../src/services/password-service.ts";
import {
  clientConnections,
  cerrarConexionesNativeSession,
  registrarConexionWebsocket,
  type WebsocketSocket,
} from "../src/plugins/websocket.ts";

const PASSWORD = "NativePassword123!";
const metadata = { platform: "android" as const, appBuild: 10, appVersion: "1.0.0" };

class SocketControlado implements WebsocketSocket {
  readyState = 1;
  cierres = 0;
  private listeners = new Map<string, Array<() => void>>();

  send(): void {}
  ping(): void {}
  close(): void {
    this.cierres += 1;
    this.readyState = 3;
    for (const listener of this.listeners.get("close") ?? []) listener();
  }
  terminate(): void { this.close(); }
  on(event: "close" | "pong", listener: () => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
}

async function activeCount(idUsuario: number): Promise<number> {
  const { rows } = await myPool.query<{ cantidad: string }>(
    `SELECT count(*) AS cantidad
       FROM sesion_nativa s
       JOIN usuario u ON u.id_usuario = s.id_usuario
      WHERE s.id_usuario = $1 AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND s.version_sesion_emitida = u.version_sesion`,
    [idUsuario],
  );
  return Number(rows[0].cantidad);
}

async function historicalSession(
  idUsuario: number,
  config: ReturnType<typeof cargarConfiguracionRuntime>,
  createdOffset: string,
  expiresOffset: string,
  revokedOffset: string | null,
  version = 1,
): Promise<number> {
  const hash = hmacTokenNativo(
    generarTokenNativo("session"),
    config.nativeAuth.hmacSecret,
    "session",
  );
  const { rows } = await myPool.query<{ id_sesion_nativa: string }>(
    `INSERT INTO sesion_nativa(
       id_usuario,token_hash,installation_id,version_sesion_emitida,
       platform,app_build_at_login,created_at,expires_at,revoked_at,revocation_reason
     ) VALUES(
       $1,$2,$3,$4,'android',10,now()+$5::interval,now()+$6::interval,
       CASE WHEN $7::text IS NULL THEN NULL ELSE now()+$7::interval END,
       CASE WHEN $7::text IS NULL THEN NULL ELSE 'user_logout' END
     ) RETURNING id_sesion_nativa`,
    [idUsuario, hash, randomUUID(), version, createdOffset, expiresOffset, revokedOffset],
  );
  return Number(rows[0].id_sesion_nativa);
}

test("RSP-09B funciona sobre PostgreSQL real con concurrencia y HTTP", async () => {
  const config = cargarConfiguracionRuntime();
  const passwordHash = await hashPassword(PASSWORD);
  const runId = randomUUID();
  const fixtureNames = ["a", "b", "c", "d", "http", "owner", "limit", "state", "ios"];
  const emails = fixtureNames.map(
    (name) => `${name}-${runId}@native.example.test`,
  );
  const users = new Map<string, number>();
  for (const email of emails) {
    const access = fixtureNames[emails.indexOf(email)] !== "owner";
    const { rows } = await myPool.query<{ id_usuario: string }>(
      `INSERT INTO usuario(email,nombre,password,activo,cuenta_acceso)
       VALUES($1,$2,$3,TRUE,$4) RETURNING id_usuario`,
      [email, email.split("@")[0], access ? passwordHash : null, access],
    );
    const id = Number(rows[0].id_usuario);
    users.set(email, id);
    if (access) {
      await myPool.query(
        `INSERT INTO usuario_rol(id_usuario,id_rol)
         SELECT $1,id_rol FROM rol WHERE nombre='perforador'`,
        [id],
      );
    }
  }

  const userA = users.get(emails[0])!;
  const initial = await crearSesionNative({
    email: emails[0], password: PASSWORD, installationId: randomUUID(), ...metadata,
  }, config);
  assert.match(initial.token, /^rspn1_[A-Za-z0-9_-]{43}$/);
  const stored = await myPool.query<{ token_hash: Buffer; raw_present: boolean }>(
    `SELECT token_hash, position($2 in encode(token_hash,'hex')) > 0 AS raw_present
       FROM sesion_nativa WHERE id_sesion_nativa=$1`,
    [initial.idSesionNativa, initial.token],
  );
  assert.equal(stored.rows[0].token_hash.length, 32);
  assert.equal(stored.rows[0].raw_present, false);
  assert.deepEqual(
    stored.rows[0].token_hash,
    hmacTokenNativo(initial.token, config.nativeAuth.hmacSecret, "session"),
  );
  assert.equal((await resolverSesionNative(initial.token, config))?.idUsuario, userA);

  await assert.rejects(
    () => crearSesionNative({
      email: emails[0], password: "incorrecta", installationId: randomUUID(), ...metadata,
    }, config),
    /Credenciales incorrectas/,
  );
  await assert.rejects(
    () => crearSesionNative({
      email: emails[5], password: PASSWORD, installationId: randomUUID(), ...metadata,
    }, config),
    /Credenciales incorrectas/,
  );
  await assert.rejects(
    () => crearSesionNative({
      email: "desconocido@native.example.test",
      password: PASSWORD,
      installationId: randomUUID(),
      ...metadata,
    }, config),
    /Credenciales incorrectas/,
  );

  const stateUser = users.get(emails[7])!;
  await myPool.query("UPDATE usuario SET activo=FALSE WHERE id_usuario=$1", [stateUser]);
  await assert.rejects(
    () => crearSesionNative({
      email: emails[7], password: PASSWORD, installationId: randomUUID(), ...metadata,
    }, config),
    /Credenciales incorrectas/,
  );
  await myPool.query("UPDATE usuario SET activo=TRUE WHERE id_usuario=$1", [stateUser]);
  const stateSession = await crearSesionNative({
    email: emails[7], password: PASSWORD, installationId: randomUUID(), ...metadata,
  }, config);
  await myPool.query(
    "UPDATE usuario SET activo=FALSE, version_sesion=version_sesion+1 WHERE id_usuario=$1",
    [stateUser],
  );
  assert.equal(await resolverSesionNative(stateSession.token, config), null);
  await myPool.query("UPDATE usuario SET activo=TRUE WHERE id_usuario=$1", [stateUser]);
  assert.equal(
    await resolverSesionNative(stateSession.token, config),
    null,
    "una sesión con versión vieja no revive al reactivar la cuenta",
  );
  const expiredSession = await crearSesionNative({
    email: emails[7], password: PASSWORD, installationId: randomUUID(), ...metadata,
  }, config);
  await myPool.query(
    `UPDATE sesion_nativa
        SET created_at=now()-interval '2 days', expires_at=now()-interval '1 day'
      WHERE id_sesion_nativa=$1`,
    [expiredSession.idSesionNativa],
  );
  assert.equal(await resolverSesionNative(expiredSession.token, config), null);

  while ((await activeCount(userA)) < 4) {
    await crearSesionNative({
      email: emails[0], password: PASSWORD, installationId: randomUUID(), ...metadata,
    }, config);
  }
  await Promise.all([1, 2].map(() => crearSesionNative({
    email: emails[0], password: PASSWORD, installationId: randomUUID(), ...metadata,
  }, config)));
  assert.equal(await activeCount(userA), 5, "4 + 2 logins deben terminar en cinco activas");

  const userB = users.get(emails[1])!;
  await Promise.all(Array.from({ length: 6 }, () => crearSesionNative({
    email: emails[1], password: PASSWORD, installationId: randomUUID(), ...metadata,
  }, config)));
  assert.equal(await activeCount(userB), 5, "0 + 6 logins deben terminar exactamente en cinco");

  const limitUser = users.get(emails[6])!;
  const ignoredExpired = await crearSesionNative({
    email: emails[6], password: PASSWORD, installationId: randomUUID(), ...metadata,
  }, config);
  await myPool.query(
    `UPDATE sesion_nativa
        SET created_at=now()-interval '3 days', expires_at=now()-interval '2 days'
      WHERE id_sesion_nativa=$1`,
    [ignoredExpired.idSesionNativa],
  );
  const ignoredRevoked = await crearSesionNative({
    email: emails[6], password: PASSWORD, installationId: randomUUID(), ...metadata,
  }, config);
  await revocarSesionNativePorToken(ignoredRevoked.token, config);
  const ignoredVersion = await crearSesionNative({
    email: emails[6], password: PASSWORD, installationId: randomUUID(), ...metadata,
  }, config);
  await myPool.query(
    "UPDATE sesion_nativa SET version_sesion_emitida=version_sesion_emitida+100 WHERE id_sesion_nativa=$1",
    [ignoredVersion.idSesionNativa],
  );
  const ordered: Awaited<ReturnType<typeof crearSesionNative>>[] = [];
  for (let index = 0; index < 5; index += 1) {
    const session = await crearSesionNative({
      email: emails[6], password: PASSWORD, installationId: randomUUID(), ...metadata,
    }, config);
    ordered.push(session);
    await myPool.query(
      "UPDATE sesion_nativa SET created_at=now()-make_interval(mins => $2) WHERE id_sesion_nativa=$1",
      [session.idSesionNativa, 10 - index],
    );
  }
  assert.equal(await activeCount(limitUser), 5);
  const newest = await crearSesionNative({
    email: emails[6], password: PASSWORD, installationId: randomUUID(), ...metadata,
  }, config);
  assert.equal(await activeCount(limitUser), 5);
  assert.equal(await resolverSesionNative(ordered[0].token, config), null);
  assert.notEqual(await resolverSesionNative(ordered[1].token, config), null);
  assert.notEqual(await resolverSesionNative(newest.token, config), null);
  const ignoredReasons = await myPool.query<{ id_sesion_nativa: string; revocation_reason: string | null }>(
    `SELECT id_sesion_nativa,revocation_reason FROM sesion_nativa
      WHERE id_sesion_nativa=ANY($1::bigint[]) ORDER BY id_sesion_nativa`,
    [[ignoredExpired.idSesionNativa, ignoredRevoked.idSesionNativa, ignoredVersion.idSesionNativa]],
  );
  assert.deepEqual(
    ignoredReasons.rows.map((row) => row.revocation_reason),
    [null, "user_logout", null],
    "expiradas, revocadas y versiones viejas no son candidatas de eviction activa",
  );

  const userC = users.get(emails[2])!;
  const sharedInstallation = randomUUID();
  const replacements = await Promise.all([1, 2].map(() => crearSesionNative({
    email: emails[2], password: PASSWORD, installationId: sharedInstallation, ...metadata,
  }, config)));
  assert.equal(await activeCount(userC), 1);
  const activeReplacement = await Promise.all(
    replacements.map((session) => resolverSesionNative(session.token, config)),
  );
  assert.equal(activeReplacement.filter(Boolean).length, 1);
  const replacementIdentity = activeReplacement.find((session): session is NonNullable<typeof session> => session !== null)!;
  const replacementSocket = new SocketControlado();
  registrarConexionWebsocket({
    id_usuario: userC,
    socket: replacementSocket,
    auth: {
      kind: "native",
      versionSesion: replacementIdentity.versionSesionEmitida,
      nativeSessionId: replacementIdentity.idSesionNativa,
      nativePlatform: replacementIdentity.platform,
      nativeAppBuild: metadata.appBuild,
    },
  });
  await crearSesionNative({
    email: emails[2], password: PASSWORD, installationId: sharedInstallation, ...metadata,
  }, config);
  assert.equal(replacementSocket.cierres, 1, "same-installation replacement cierra el WS después del commit");

  const { rows: oldestRows } = await myPool.query<{ id_sesion_nativa: string }>(
    `SELECT id_sesion_nativa FROM sesion_nativa
      WHERE id_usuario = $1 AND revoked_at IS NULL
      ORDER BY created_at ASC, id_sesion_nativa ASC LIMIT 1`,
    [userA],
  );
  const evictionSessionId = Number(oldestRows[0].id_sesion_nativa);
  const evictionSocket = new SocketControlado();
  registrarConexionWebsocket({
    id_usuario: userA,
    socket: evictionSocket,
    auth: { kind: "native", versionSesion: 1, nativeSessionId: evictionSessionId, nativePlatform: "android", nativeAppBuild: 10 },
  });
  await crearSesionNative({
    email: emails[0], password: PASSWORD, installationId: randomUUID(), ...metadata,
  }, config);
  assert.equal(evictionSocket.cierres, 1, "max-session eviction cierra el WS después del commit");
  assert.equal(clientConnections.some((connection) => connection.socket === evictionSocket), false);

  const userD = users.get(emails[3])!;
  const isolated = await crearSesionNative({
    email: emails[3], password: PASSWORD, installationId: randomUUID(), ...metadata,
  }, config);
  assert.equal(await activeCount(userD), 1);
  assert.equal((await resolverSesionNative(isolated.token, config))?.idUsuario, userD);

  const logoutTarget = await crearSesionNative({
    email: emails[3], password: PASSWORD, installationId: randomUUID(), ...metadata,
  }, config);
  const logoutResults = await Promise.all([
    revocarSesionNativePorToken(logoutTarget.token, config),
    revocarSesionNativePorToken(logoutTarget.token, config),
  ]);
  assert.deepEqual(logoutResults.sort(), [false, true]);
  const revokedAt = await myPool.query<{ revoked_at: Date }>(
    "SELECT revoked_at FROM sesion_nativa WHERE id_sesion_nativa=$1",
    [logoutTarget.idSesionNativa],
  );
  assert.equal(await revocarSesionNativePorToken(logoutTarget.token, config), false);
  assert.equal(
    await revocarSesionNativePorToken(generarTokenNativo("session"), config),
    false,
    "un token desconocido bien formado conserva semántica anti-oracle",
  );
  const revokedAtRetry = await myPool.query<{ revoked_at: Date }>(
    "SELECT revoked_at FROM sesion_nativa WHERE id_sesion_nativa=$1",
    [logoutTarget.idSesionNativa],
  );
  assert.equal(
    revokedAtRetry.rows[0].revoked_at.toISOString(),
    revokedAt.rows[0].revoked_at.toISOString(),
  );
  assert.equal(await resolverSesionNative(logoutTarget.token, config), null);

  const ticketParent = isolated;
  const ticket = await emitirTicketWsNative(ticketParent, metadata, config);
  assert.match(ticket.ticket, /^rspw1_[A-Za-z0-9_-]{43}$/);
  const storedTicket = await myPool.query<{
    ticket_hash: Buffer;
    id_sesion_nativa: string;
    platform: string;
    app_build_emitido: number;
  }>(
    `SELECT ticket_hash,id_sesion_nativa,platform,app_build_emitido
       FROM ticket_ws_nativo WHERE id_sesion_nativa=$1 ORDER BY id_ticket_ws_nativo DESC LIMIT 1`,
    [ticketParent.idSesionNativa],
  );
  assert.deepEqual(
    storedTicket.rows[0].ticket_hash,
    hmacTokenNativo(ticket.ticket, config.nativeAuth.hmacSecret, "ws-ticket"),
  );
  assert.equal(Number(storedTicket.rows[0].id_sesion_nativa), ticketParent.idSesionNativa);
  assert.equal(storedTicket.rows[0].platform, "android");
  assert.equal(storedTicket.rows[0].app_build_emitido, 10);
  assert.ok(ticket.expiresAt.getTime() > Date.now());
  assert.ok(ticket.expiresAt.getTime() - Date.now() <= 31_000);

  const janitor = new NativeAuthJanitor(myPool, config, {
    info() {}, warn() {}, error() {},
  });
  await janitor.start();
  registrarNativeAuthJanitor(janitor);

  const app = Fastify({ logger: false });
  await app.register(cookies);
  await app.register(jwt);
  await app.register(rateLimit);
  await app.register(csrf);
  await app.register(errorHandler);
  await app.register(nativeAuthRoutes);
  app.get("/business", { onRequest: [app.authenticate] }, async (req) => ({ id: req.user.sub }));
  app.post("/business", { onRequest: [app.authenticate] }, async (req) => ({ id: req.user.sub }));
  await app.ready();

  try {
    const nativeHeaders = {
      "x-native-platform": "android",
      "x-native-app-build": "10",
      "x-native-app-version": "1.0.0",
    };
    const missingMetadataLogin = await app.inject({
      method: "POST",
      url: "/auth/native/login",
      payload: { email: emails[4], password: PASSWORD, installation_id: randomUUID() },
    });
    assert.equal(missingMetadataLogin.statusCode, 400);
    assert.equal(missingMetadataLogin.json().code, "ERR_NATIVE_METADATA_T05");
    assert.notEqual(missingMetadataLogin.json().code, "FST_ERR_VALIDATION");
    const obsoleteAndroidLogin = await app.inject({
      method: "POST",
      url: "/auth/native/login",
      headers: { ...nativeHeaders, "x-native-app-build": "9" },
      payload: { email: emails[4], password: PASSWORD, installation_id: randomUUID() },
    });
    assert.equal(obsoleteAndroidLogin.statusCode, 426);
    assert.equal(obsoleteAndroidLogin.json().code, "NATIVE_APP_UPGRADE_REQUIRED");
    assert.equal((await app.inject({
      method: "POST",
      url: "/auth/native/login",
      headers: {
        ...nativeHeaders,
        "x-native-platform": "ios",
        "x-native-app-build": "19",
      },
      payload: { email: emails[4], password: PASSWORD, installation_id: randomUUID() },
    })).statusCode, 426);
    assert.equal(await activeCount(users.get(emails[4])!), 0);
    const login = await app.inject({
      method: "POST",
      url: "/auth/native/login",
      headers: nativeHeaders,
      payload: {
        email: emails[4], password: PASSWORD, installation_id: randomUUID(),
      },
    });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(login.headers["set-cookie"], undefined);
    const httpToken = login.json().session_token as string;
    assert.deepEqual(Object.keys(login.json().user).sort(), ["id_usuario", "nombre", "roles"]);
    const authHeaders = { ...nativeHeaders, authorization: `Bearer ${httpToken}` };
    const loginWithoutAppVersion = await app.inject({
      method: "POST",
      url: "/auth/native/login",
      headers: {
        "x-native-platform": "android",
        "x-native-app-build": "10",
      },
      payload: {
        email: emails[4], password: PASSWORD, installation_id: randomUUID(),
      },
    });
    assert.equal(loginWithoutAppVersion.statusCode, 200, loginWithoutAppVersion.body);
    for (const endpoint of [
      { method: "GET" as const, url: "/auth/native/session" },
      { method: "POST" as const, url: "/auth/native/logout-all" },
      { method: "POST" as const, url: "/auth/native/ws-ticket" },
      { method: "GET" as const, url: "/business" },
    ]) {
      const malformedMetadata = await app.inject({
        ...endpoint,
        headers: { ...authHeaders, "x-native-app-build": "abc" },
      });
      assert.equal(malformedMetadata.statusCode, 400, endpoint.url);
      assert.equal(malformedMetadata.json().code, "ERR_NATIVE_METADATA_T05", endpoint.url);
      assert.notEqual(malformedMetadata.json().code, "FST_ERR_VALIDATION", endpoint.url);
    }
    const sessionResponse = await app.inject({
      method: "GET", url: "/auth/native/session", headers: authHeaders,
    });
    assert.equal(sessionResponse.statusCode, 200);
    assert.equal(sessionResponse.body.includes("session_token"), false);
    assert.equal(sessionResponse.body.includes("token_hash"), false);
    assert.equal((await app.inject({
      method: "GET", url: "/auth/native/session",
      headers: { ...authHeaders, "x-native-app-build": "11", "x-native-app-version": "0.0.0" },
    })).statusCode, 200, "el build actual y no app_version gobierna enforcement");
    assert.equal((await app.inject({
      method: "GET", url: "/auth/native/session",
      headers: { ...authHeaders, "x-native-platform": "ios", "x-native-app-build": "20" },
    })).statusCode, 400, "la plataforma debe coincidir con la sesión");
    assert.equal((await app.inject({
      method: "GET", url: "/auth/native/session",
      headers: { ...authHeaders, "x-native-app-build": "9" },
    })).statusCode, 426);
    assert.equal((await app.inject({
      method: "POST", url: "/business", headers: authHeaders,
    })).statusCode, 200, "Bearer válido no exige CSRF");

    const httpUser = users.get(emails[4])!;
    const webToken = app.jwt.sign({ sub: httpUser, version_sesion: 1 });
    assert.equal((await app.inject({
      method: "POST", url: "/business",
      cookies: { [SESSION_COOKIE]: webToken },
    })).statusCode, 403, "cookie mutation sin CSRF debe fallar");
    assert.equal((await app.inject({
      method: "POST", url: "/business",
      cookies: { [SESSION_COOKIE]: webToken, [CSRF_COOKIE]: "control" },
      headers: { "x-csrf-token": "control" },
    })).statusCode, 200, "web cookie con CSRF sigue funcionando");
    assert.equal((await app.inject({
      method: "GET", url: "/business",
      cookies: { [SESSION_COOKIE]: webToken },
      headers: { ...nativeHeaders, authorization: `Bearer rspn1_${"A".repeat(43)}` },
    })).statusCode, 401, "Bearer inválido nunca cae a cookie válida");
    assert.equal((await app.inject({
      method: "GET", url: "/auth/native/session",
      cookies: { [SESSION_COOKIE]: webToken },
      headers: nativeHeaders,
    })).statusCode, 401, "una ruta native no usa cookie como fallback");
    assert.equal((await app.inject({
      method: "GET", url: "/business",
      cookies: { [SESSION_COOKIE]: webToken },
      headers: { ...nativeHeaders, authorization: "Bearer inválido" },
    })).statusCode, 401, "Bearer malformado tampoco cae a cookie");

    const iosLogin = await app.inject({
      method: "POST",
      url: "/auth/native/login",
      headers: {
        "x-native-platform": "ios",
        "x-native-app-build": "20",
        "x-native-app-version": "0.0.1",
      },
      payload: { email: emails[8], password: PASSWORD, installation_id: randomUUID() },
    });
    assert.equal(iosLogin.statusCode, 200, iosLogin.body);

    assert.equal((await app.inject({
      method: "POST", url: "/auth/native/ws-ticket",
      headers: { ...authHeaders, "x-native-app-build": "9" },
    })).statusCode, 426);
    const ticket1 = await app.inject({ method: "POST", url: "/auth/native/ws-ticket", headers: authHeaders });
    const ticket2 = await app.inject({ method: "POST", url: "/auth/native/ws-ticket", headers: authHeaders });
    const ticket3 = await app.inject({
      method: "POST",
      url: "/auth/native/ws-ticket",
      headers: authHeaders,
      remoteAddress: "203.0.113.45",
    });
    assert.equal(ticket1.statusCode, 200, ticket1.body);
    assert.equal(ticket2.statusCode, 200, ticket2.body);
    assert.equal(ticket3.statusCode, 429, "cambiar IP no amplía el cupo por sesión");

    const redeemed = await consumirTicketWsNative(ticket1.json().ticket, config);
    assert.equal(redeemed?.idUsuario, httpUser);
    assert.equal(await consumirTicketWsNative(ticket1.json().ticket, config), null, "ticket single-use");
    const raceTicket = ticket2.json().ticket as string;
    const raceResults = await Promise.all([
      consumirTicketWsNative(raceTicket, config),
      consumirTicketWsNative(raceTicket, config),
    ]);
    assert.equal(raceResults.filter((result) => result !== null).length, 1, "una sola redención concurrente gana");
    assert.equal(raceResults.filter((result) => result === null).length, 1);

    const logoutAll = await app.inject({
      method: "POST",
      url: "/auth/native/logout-all",
      headers: { ...authHeaders, "x-native-app-build": "1" },
    });
    assert.equal(logoutAll.statusCode, 204, logoutAll.body);
    assert.equal((await app.inject({
      method: "GET", url: "/auth/native/session", headers: authHeaders,
    })).statusCode, 401);
    assert.equal((await app.inject({
      method: "POST", url: "/auth/native/logout-all", headers: authHeaders,
    })).statusCode, 401, "logout-all exige una sesión todavía activa");

    const logout = await app.inject({
      method: "POST", url: "/auth/native/logout",
      headers: { authorization: `Bearer ${httpToken}` },
    });
    const logoutRetry = await app.inject({
      method: "POST", url: "/auth/native/logout",
      headers: { authorization: `Bearer ${httpToken}` },
    });
    assert.equal(logout.statusCode, 204);
    assert.equal(logoutRetry.statusCode, 204);
    assert.equal(logout.body, "");
    assert.equal(logoutRetry.body, "");
    assert.equal((await app.inject({
      method: "POST", url: "/auth/native/logout",
      headers: { authorization: `Bearer ${generarTokenNativo("session")}` },
    })).statusCode, 204);
    assert.equal((await app.inject({
      method: "POST", url: "/auth/native/logout",
    })).statusCode, 401);
    assert.equal((await app.inject({
      method: "POST", url: "/auth/native/logout",
      headers: { authorization: "Basic credencial" },
    })).statusCode, 401);

    const keepDevice = await crearSesionNative({
      email: emails[3], password: PASSWORD, installationId: randomUUID(), ...metadata,
    }, config);
    const closeDevice = await crearSesionNative({
      email: emails[3], password: PASSWORD, installationId: randomUUID(), ...metadata,
    }, config);
    const revokedDevice = await crearSesionNative({
      email: emails[3], password: PASSWORD, installationId: randomUUID(), ...metadata,
    }, config);
    const revokedBeforeRedemptionTicket = await emitirTicketWsNative(revokedDevice, metadata, config);
    assert.equal(await revocarSesionNativePorToken(closeDevice.token, config), true);
    assert.equal(await revocarSesionNativePorToken(revokedDevice.token, config), true);
    assert.equal(
      await consumirTicketWsNative(revokedBeforeRedemptionTicket.ticket, config),
      null,
      "ticket emitido antes de logout no revive la sesión padre",
    );
    assert.equal(await resolverSesionNative(closeDevice.token, config), null);
    assert.notEqual(
      await resolverSesionNative(keepDevice.token, config),
      null,
      "logout-device no revoca otra instalación",
    );

    const activeHistorical = await historicalSession(
      userD, config, "-1 day", "+1 day", null,
    );
    const revokedRecent = await historicalSession(
      userD, config, "-10 days", "+1 day", "-1 day",
    );
    const revokedOld = await historicalSession(
      userD, config, "-40 days", "+1 day", "-31 days",
    );
    const expiredRecent = await historicalSession(
      userD, config, "-3 days", "-1 day", null,
    );
    const expiredOld = await historicalSession(
      userD, config, "-70 days", "-31 days", null,
    );
    const oldVersionFuture = await historicalSession(
      userD, config, "-1 day", "+1 day", null, 999,
    );
    const residualTicketHash = hmacTokenNativo(
      generarTokenNativo("ws-ticket"),
      config.nativeAuth.hmacSecret,
      "ws-ticket",
    );
    await myPool.query(
      `INSERT INTO ticket_ws_nativo(
         id_sesion_nativa,ticket_hash,platform,app_build_emitido,expires_at
       ) VALUES($1,$2,'android',10,now()+interval '30 seconds')`,
      [revokedOld, residualTicketHash],
    );
    const oldTicketHash = hmacTokenNativo(
      generarTokenNativo("ws-ticket"),
      config.nativeAuth.hmacSecret,
      "ws-ticket",
    );
    await myPool.query(
      `INSERT INTO ticket_ws_nativo(
         id_sesion_nativa,ticket_hash,platform,app_build_emitido,created_at,expires_at
       ) VALUES($1,$2,'android',10,now()-interval '2 hours',now()-interval '61 minutes')`,
      [activeHistorical, oldTicketHash],
    );

    const cleanup = await janitor.sweep();
    assert.ok(cleanup.ticketsDeleted >= 1);
    assert.ok(cleanup.sessionsDeleted >= 2);
    const states = await myPool.query<{ id_sesion_nativa: string }>(
      `SELECT id_sesion_nativa FROM sesion_nativa
        WHERE id_sesion_nativa = ANY($1::bigint[]) ORDER BY id_sesion_nativa`,
      [[activeHistorical, revokedRecent, revokedOld, expiredRecent, expiredOld, oldVersionFuture]],
    );
    const remaining = new Set(states.rows.map((row) => Number(row.id_sesion_nativa)));
    assert.equal(remaining.has(activeHistorical), true);
    assert.equal(remaining.has(revokedRecent), true);
    assert.equal(remaining.has(expiredRecent), true);
    assert.equal(remaining.has(oldVersionFuture), true);
    assert.equal(remaining.has(revokedOld), false);
    assert.equal(remaining.has(expiredOld), false);
    const residual = await myPool.query<{ cantidad: string }>(
      "SELECT count(*) AS cantidad FROM ticket_ws_nativo WHERE ticket_hash=$1",
      [residualTicketHash],
    );
    assert.equal(Number(residual.rows[0].cantidad), 0, "FK cascade elimina ticket residual");
    const secondCleanup = await janitor.sweep();
    assert.deepEqual(secondCleanup, { ticketsDeleted: 0, sessionsDeleted: 0, hasBacklog: false });
  } finally {
    for (const connection of [...clientConnections]) {
      cerrarConexionesNativeSession(connection.auth?.nativeSessionId ?? -1);
    }
    await app.close();
    janitor.stop();
    registrarNativeAuthJanitor(null);
    await myPool.end();
  }
});
