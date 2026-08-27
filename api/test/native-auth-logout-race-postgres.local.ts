import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { cargarConfiguracionRuntime } from "../src/config/runtime.ts";
import { myPool } from "../src/db/pool.ts";
import {
  crearSesionNative,
  resolverSesionNative,
  revocarSesionNativePorToken,
} from "../src/services/native-auth-service.ts";
import { generarTokenNativo, hmacTokenNativo } from "../src/services/native-token-service.ts";
import { hashPassword } from "../src/services/password-service.ts";

const PASSWORD = "NativeRacePassword123!";
const METADATA = { platform: "android" as const, appBuild: 10, appVersion: "1.0.0" };
const LOGIN_LOCK_MARKER = "native-login-user-lock";
const LOGOUT_LOCK_MARKER = "native-logout-user-lock";

interface SeedSession {
  id: number;
  token: string;
  installationId: string;
}

async function createUser(label: string, passwordHash: string): Promise<{ id: number; email: string }> {
  const email = `rsp09b-r1-${label}-${randomUUID()}@example.test`;
  const { rows } = await myPool.query<{ id_usuario: string }>(
    `INSERT INTO usuario(email,nombre,password,activo,cuenta_acceso)
     VALUES($1,$2,$3,TRUE,TRUE)
     RETURNING id_usuario`,
    [email, label, passwordHash],
  );
  return { id: Number(rows[0].id_usuario), email };
}

async function seedSessions(
  idUsuario: number,
  count: number,
  config: ReturnType<typeof cargarConfiguracionRuntime>,
  lastInstallationId?: string,
): Promise<SeedSession[]> {
  const sessions: SeedSession[] = [];
  for (let index = 0; index < count; index += 1) {
    const token = generarTokenNativo("session");
    const installationId = index === count - 1 && lastInstallationId
      ? lastInstallationId
      : randomUUID();
    const { rows } = await myPool.query<{ id_sesion_nativa: string }>(
      `INSERT INTO sesion_nativa(
         id_usuario,token_hash,installation_id,version_sesion_emitida,
         platform,app_build_at_login,created_at,expires_at
       ) VALUES(
         $1,$2,$3,1,'android',10,
         now()-make_interval(mins => $4),now()+interval '30 days'
       )
       RETURNING id_sesion_nativa`,
      [
        idUsuario,
        hmacTokenNativo(token, config.nativeAuth.hmacSecret, "session"),
        installationId,
        count - index,
      ],
    );
    sessions.push({ id: Number(rows[0].id_sesion_nativa), token, installationId });
  }
  return sessions;
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
  throw new Error(`La operación ${marker} no quedó esperando el lock de usuario`);
}

async function runInQueuedOrder<TFirst, TSecond>(
  idUsuario: number,
  firstMarker: string,
  first: () => Promise<TFirst>,
  secondMarker: string,
  second: () => Promise<TSecond>,
): Promise<[TFirst, TSecond]> {
  const barrier = await myPool.connect();
  let released = false;
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
    released = true;
    return await Promise.all([firstPromise, secondPromise]);
  } finally {
    if (!released) {
      await barrier.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled([firstPromise, secondPromise].filter(Boolean));
    }
    barrier.release(!released);
  }
}

async function reasons(ids: number[]): Promise<Map<number, string | null>> {
  const { rows } = await myPool.query<{
    id_sesion_nativa: string;
    revocation_reason: string | null;
  }>(
    `SELECT id_sesion_nativa,revocation_reason
       FROM sesion_nativa
      WHERE id_sesion_nativa=ANY($1::bigint[])`,
    [ids],
  );
  return new Map(rows.map((row) => [Number(row.id_sesion_nativa), row.revocation_reason]));
}

test("logout-device y login al límite respetan un orden serial por usuario", async () => {
  const config = cargarConfiguracionRuntime();
  const passwordHash = await hashPassword(PASSWORD);

  try {
    const logoutFirstUser = await createUser("logout-first", passwordHash);
    const logoutFirstSessions = await seedSessions(logoutFirstUser.id, 5, config);
    const logoutTarget = logoutFirstSessions[4];
    const [logoutWon, sessionAfterLogout] = await runInQueuedOrder(
      logoutFirstUser.id,
      LOGOUT_LOCK_MARKER,
      () => revocarSesionNativePorToken(logoutTarget.token, config),
      LOGIN_LOCK_MARKER,
      () => crearSesionNative({
        email: logoutFirstUser.email,
        password: PASSWORD,
        installationId: randomUUID(),
        ...METADATA,
      }, config),
    );
    assert.equal(logoutWon, true);
    assert.equal(await activeCount(logoutFirstUser.id), 5);
    assert.equal(await resolverSesionNative(logoutTarget.token, config), null);
    assert.notEqual(await resolverSesionNative(sessionAfterLogout.token, config), null);
    for (const session of logoutFirstSessions.slice(0, 4)) {
      assert.notEqual(
        await resolverSesionNative(session.token, config),
        null,
        "logout primero no debe provocar una eviction basada en count stale",
      );
    }
    const logoutFirstReasons = await reasons(logoutFirstSessions.map((session) => session.id));
    assert.deepEqual(
      logoutFirstSessions.map((session) => logoutFirstReasons.get(session.id)),
      [null, null, null, null, "user_logout"],
    );

    const loginFirstUser = await createUser("login-first", passwordHash);
    const loginFirstSessions = await seedSessions(loginFirstUser.id, 5, config);
    const explicitTarget = loginFirstSessions[4];
    const [sessionBeforeLogout, logoutAfterLogin] = await runInQueuedOrder(
      loginFirstUser.id,
      LOGIN_LOCK_MARKER,
      () => crearSesionNative({
        email: loginFirstUser.email,
        password: PASSWORD,
        installationId: randomUUID(),
        ...METADATA,
      }, config),
      LOGOUT_LOCK_MARKER,
      () => revocarSesionNativePorToken(explicitTarget.token, config),
    );
    assert.equal(logoutAfterLogin, true);
    assert.equal(await activeCount(loginFirstUser.id), 4);
    assert.equal(await resolverSesionNative(loginFirstSessions[0].token, config), null);
    assert.equal(await resolverSesionNative(explicitTarget.token, config), null);
    assert.notEqual(await resolverSesionNative(sessionBeforeLogout.token, config), null);
    for (const session of loginFirstSessions.slice(1, 4)) {
      assert.notEqual(await resolverSesionNative(session.token, config), null);
    }
    const loginFirstReasons = await reasons(loginFirstSessions.map((session) => session.id));
    assert.equal(loginFirstReasons.get(loginFirstSessions[0].id), "session_limit_eviction");
    assert.equal(loginFirstReasons.get(explicitTarget.id), "user_logout");

    const sameTokenUser = await createUser("same-token", passwordHash);
    const [sameToken] = await seedSessions(sameTokenUser.id, 1, config);
    const sameTokenResults = await Promise.all([
      revocarSesionNativePorToken(sameToken.token, config),
      revocarSesionNativePorToken(sameToken.token, config),
    ]);
    assert.deepEqual(sameTokenResults.sort(), [false, true]);
    const firstRevocation = await myPool.query<{ revoked_at: Date }>(
      "SELECT revoked_at FROM sesion_nativa WHERE id_sesion_nativa=$1",
      [sameToken.id],
    );
    assert.equal(await revocarSesionNativePorToken(sameToken.token, config), false);
    const retryRevocation = await myPool.query<{ revoked_at: Date }>(
      "SELECT revoked_at FROM sesion_nativa WHERE id_sesion_nativa=$1",
      [sameToken.id],
    );
    assert.equal(
      retryRevocation.rows[0].revoked_at.toISOString(),
      firstRevocation.rows[0].revoked_at.toISOString(),
    );
    assert.equal(await revocarSesionNativePorToken(generarTokenNativo("session"), config), false);

    const twoLogoutUser = await createUser("two-logouts", passwordHash);
    const twoLogoutSessions = await seedSessions(twoLogoutUser.id, 3, config);
    assert.deepEqual(
      await Promise.all(twoLogoutSessions.slice(0, 2).map((session) => (
        revocarSesionNativePorToken(session.token, config)
      ))),
      [true, true],
    );
    assert.equal(await activeCount(twoLogoutUser.id), 1);
    assert.notEqual(await resolverSesionNative(twoLogoutSessions[2].token, config), null);

    const isolatedA = await createUser("isolated-a", passwordHash);
    const isolatedB = await createUser("isolated-b", passwordHash);
    const [isolatedASession] = await seedSessions(isolatedA.id, 1, config);
    const [isolatedBSession] = await seedSessions(isolatedB.id, 1, config);
    const barrier = await myPool.connect();
    let barrierReleased = false;
    let logoutA: Promise<boolean> | undefined;
    try {
      await barrier.query("BEGIN");
      await barrier.query(
        "SELECT id_usuario FROM usuario WHERE id_usuario=$1 FOR UPDATE",
        [isolatedA.id],
      );
      logoutA = revocarSesionNativePorToken(isolatedASession.token, config);
      await waitUntilBlocked(LOGOUT_LOCK_MARKER);
      const logoutB = await Promise.race([
        revocarSesionNativePorToken(isolatedBSession.token, config),
        delay(2_000).then(() => {
          throw new Error("el lock del usuario A bloqueó indebidamente al usuario B");
        }),
      ]);
      assert.equal(logoutB, true);
      await barrier.query("COMMIT");
      barrierReleased = true;
      assert.equal(await logoutA, true);
    } finally {
      if (!barrierReleased) {
        await barrier.query("ROLLBACK").catch(() => undefined);
        await Promise.allSettled([logoutA].filter(Boolean));
      }
      barrier.release(!barrierReleased);
    }

    const sharedInstallation = randomUUID();
    const sameInstallationUser = await createUser("same-installation", passwordHash);
    const sameInstallationSessions = await seedSessions(
      sameInstallationUser.id,
      5,
      config,
      sharedInstallation,
    );
    const oldInstallationSession = sameInstallationSessions[4];
    const [, replacement] = await Promise.all([
      revocarSesionNativePorToken(oldInstallationSession.token, config),
      crearSesionNative({
        email: sameInstallationUser.email,
        password: PASSWORD,
        installationId: sharedInstallation,
        ...METADATA,
      }, config),
    ]);
    assert.equal(await activeCount(sameInstallationUser.id), 5);
    assert.equal(await resolverSesionNative(oldInstallationSession.token, config), null);
    assert.notEqual(await resolverSesionNative(replacement.token, config), null);
    for (const session of sameInstallationSessions.slice(0, 4)) {
      assert.notEqual(await resolverSesionNative(session.token, config), null);
    }
    const installationCount = await myPool.query<{ cantidad: string }>(
      `SELECT count(*) AS cantidad
         FROM sesion_nativa
        WHERE id_usuario=$1 AND installation_id=$2::uuid AND revoked_at IS NULL`,
      [sameInstallationUser.id, sharedInstallation],
    );
    assert.equal(Number(installationCount.rows[0].cantidad), 1);
    assert.ok(await activeCount(sameInstallationUser.id) <= config.nativeAuth.maxActiveSessionsPerUser);
  } finally {
    await myPool.end();
  }
});
