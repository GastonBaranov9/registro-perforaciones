import type { PoolClient } from "pg";
import { myPool } from "../db/pool.ts";
import type { RuntimeConfig } from "../config/runtime.ts";
import { cargarConfiguracionRuntime } from "../config/runtime.ts";
import * as err from "../models/errors.ts";
import { verifyPassword } from "./password-service.ts";
import {
  generarTokenNativo,
  hmacTokenNativo,
  tokenNativoBienFormado,
} from "./native-token-service.ts";
import { cerrarConexionesNativeSession } from "../plugins/websocket.ts";

export type NativePlatform = "android" | "ios";

export interface NativeClientMetadata {
  platform: NativePlatform;
  appBuild: number;
  appVersion?: string;
}

export interface NativeLoginInput extends NativeClientMetadata {
  email: string;
  password: string;
  installationId: string;
}

interface CredencialNativeValidada {
  idUsuario: number;
  passwordHash: string;
}

export interface NativeSessionIdentity {
  idSesionNativa: number;
  idUsuario: number;
  versionSesionEmitida: number;
  platform: NativePlatform;
  expiresAt: Date;
}

export interface NativeSessionIssued extends NativeSessionIdentity {
  token: string;
}

export interface NativeWsTicketIssued {
  ticket: string;
  expiresAt: Date;
}

export interface NativeWsConnectionIdentity {
  idSesionNativa: number;
  idUsuario: number;
  versionSesionEmitida: number;
  platform: NativePlatform;
  appBuildEmitido: number;
}

function numeroEntero(value: unknown): number | null {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export async function validarCredencialesNative(
  email: string,
  plainPassword: string,
): Promise<CredencialNativeValidada> {
  const { rows } = await myPool.query<{
    id_usuario: string | number;
    password: string;
  }>(
    `SELECT id_usuario, password
       FROM usuario
      WHERE email = $1
        AND activo = TRUE
        AND cuenta_acceso = TRUE
        AND password IS NOT NULL
      LIMIT 1`,
    [email],
  );
  const row = rows[0];
  const idUsuario = numeroEntero(row?.id_usuario);
  if (!row || idUsuario === null || !(await verifyPassword(plainPassword, row.password))) {
    throw new err.T05CredencialesInvalidas();
  }
  return { idUsuario, passwordHash: row.password };
}

async function rollbackSeguro(client: PoolClient): Promise<boolean> {
  try {
    await client.query("ROLLBACK");
    return true;
  } catch {
    return false;
  }
}

export async function crearSesionNative(
  input: NativeLoginInput,
  config: RuntimeConfig = cargarConfiguracionRuntime(),
): Promise<NativeSessionIssued> {
  const credencial = await validarCredencialesNative(input.email, input.password);
  const rawToken = generarTokenNativo("session");
  const tokenHash = hmacTokenNativo(
    rawToken,
    config.nativeAuth.hmacSecret,
    "session",
  );
  const client = await myPool.connect();
  let discardClient = false;
  try {
    await client.query("BEGIN");
    const { rows: usuarios } = await client.query<{
      id_usuario: string | number;
      password: string;
      version_sesion: number;
    }>(
      `/* native-login-user-lock */
       SELECT id_usuario, password, version_sesion
         FROM usuario
        WHERE id_usuario = $1
          AND activo = TRUE
          AND cuenta_acceso = TRUE
          AND password IS NOT NULL
        FOR UPDATE`,
      [credencial.idUsuario],
    );
    const usuario = usuarios[0];
    const idUsuario = numeroEntero(usuario?.id_usuario);
    const versionSesion = numeroEntero(usuario?.version_sesion);
    if (
      !usuario ||
      idUsuario === null ||
      versionSesion === null ||
      usuario.password !== credencial.passwordHash
    ) throw new err.T05CredencialesInvalidas();

    await client.query(
      `UPDATE sesion_nativa
          SET revoked_at = now(), revocation_reason = 'installation_replaced'
        WHERE id_usuario = $1
          AND installation_id = $2::uuid
          AND revoked_at IS NULL
          AND expires_at > now()
          AND version_sesion_emitida = $3`,
      [idUsuario, input.installationId, versionSesion],
    );

    const { rows: conteoRows } = await client.query<{ cantidad: string | number }>(
      `SELECT count(*) AS cantidad
         FROM sesion_nativa
        WHERE id_usuario = $1
          AND revoked_at IS NULL
          AND expires_at > now()
          AND version_sesion_emitida = $2`,
      [idUsuario, versionSesion],
    );
    const activas = Number(conteoRows[0]?.cantidad ?? 0);
    const aRevocar = Math.max(
      0,
      activas - config.nativeAuth.maxActiveSessionsPerUser + 1,
    );
    if (aRevocar > 0) {
      await client.query(
        `WITH elegidas AS (
           SELECT id_sesion_nativa
             FROM sesion_nativa
            WHERE id_usuario = $1
              AND revoked_at IS NULL
              AND expires_at > now()
              AND version_sesion_emitida = $2
            ORDER BY created_at ASC, id_sesion_nativa ASC
            LIMIT $3
            FOR UPDATE
         )
         UPDATE sesion_nativa AS s
            SET revoked_at = now(), revocation_reason = 'session_limit_eviction'
           FROM elegidas
          WHERE s.id_sesion_nativa = elegidas.id_sesion_nativa`,
        [idUsuario, versionSesion, aRevocar],
      );
    }

    const { rows: sesiones } = await client.query<{
      id_sesion_nativa: string | number;
      expires_at: Date;
    }>(
      `INSERT INTO sesion_nativa (
         id_usuario, token_hash, installation_id, version_sesion_emitida,
         platform, app_build_at_login, app_version_at_login, expires_at
       ) VALUES (
         $1, $2, $3::uuid, $4, $5, $6, $7,
         now() + make_interval(days => $8)
       )
       RETURNING id_sesion_nativa, expires_at`,
      [
        idUsuario,
        tokenHash,
        input.installationId,
        versionSesion,
        input.platform,
        input.appBuild,
        input.appVersion ?? null,
        config.nativeAuth.sessionTtlDays,
      ],
    );
    const sesion = sesiones[0];
    const idSesionNativa = numeroEntero(sesion?.id_sesion_nativa);
    if (!sesion || idSesionNativa === null) throw new Error("No se pudo crear la sesión native");
    await client.query("COMMIT");
    return {
      token: rawToken,
      idSesionNativa,
      idUsuario,
      versionSesionEmitida: versionSesion,
      platform: input.platform,
      expiresAt: sesion.expires_at,
    };
  } catch (error) {
    discardClient = !(await rollbackSeguro(client));
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function resolverSesionNative(
  rawToken: string,
  config: RuntimeConfig = cargarConfiguracionRuntime(),
): Promise<NativeSessionIdentity | null> {
  const tokenHash = hmacTokenNativo(
    rawToken,
    config.nativeAuth.hmacSecret,
    "session",
  );
  const { rows } = await myPool.query<{
    id_sesion_nativa: string | number;
    id_usuario: string | number;
    version_sesion_emitida: number;
    platform: NativePlatform;
    expires_at: Date;
  }>(
    `SELECT s.id_sesion_nativa, s.id_usuario, s.version_sesion_emitida,
            s.platform, s.expires_at
       FROM sesion_nativa AS s
       JOIN usuario AS u ON u.id_usuario = s.id_usuario
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.activo = TRUE
        AND u.cuenta_acceso = TRUE
        AND u.password IS NOT NULL
        AND s.version_sesion_emitida = u.version_sesion
      LIMIT 1`,
    [tokenHash],
  );
  const row = rows[0];
  const idSesionNativa = numeroEntero(row?.id_sesion_nativa);
  const idUsuario = numeroEntero(row?.id_usuario);
  const versionSesionEmitida = numeroEntero(row?.version_sesion_emitida);
  if (
    !row ||
    idSesionNativa === null ||
    idUsuario === null ||
    versionSesionEmitida === null
  ) return null;
  return {
    idSesionNativa,
    idUsuario,
    versionSesionEmitida,
    platform: row.platform,
    expiresAt: row.expires_at,
  };
}

export async function revocarSesionNativePorToken(
  rawToken: string,
  config: RuntimeConfig = cargarConfiguracionRuntime(),
): Promise<boolean> {
  const tokenHash = hmacTokenNativo(
    rawToken,
    config.nativeAuth.hmacSecret,
    "session",
  );
  const { rows } = await myPool.query<{
    id_usuario: string | number;
    id_sesion_nativa: string | number;
  }>(
    `SELECT id_usuario, id_sesion_nativa
       FROM sesion_nativa
      WHERE token_hash = $1
      LIMIT 1`,
    [tokenHash],
  );
  const idUsuario = numeroEntero(rows[0]?.id_usuario);
  if (idUsuario === null) return false;

  const client = await myPool.connect();
  let discardClient = false;
  try {
    await client.query("BEGIN");
    const usuario = await client.query(
      `/* native-logout-user-lock */
       SELECT id_usuario
         FROM usuario
        WHERE id_usuario = $1
        FOR UPDATE`,
      [idUsuario],
    );
    if (!usuario.rows[0]) {
      await client.query("COMMIT");
      return false;
    }

    const { rowCount } = await client.query(
      `UPDATE sesion_nativa
          SET revoked_at = now(), revocation_reason = 'user_logout'
        WHERE token_hash = $1
          AND id_usuario = $2
          AND revoked_at IS NULL`,
      [tokenHash, idUsuario],
    );
    await client.query("COMMIT");
    if (rowCount === 1) cerrarConexionesNativeSession(Number(rows[0].id_sesion_nativa));
    return rowCount === 1;
  } catch (error) {
    discardClient = !(await rollbackSeguro(client));
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function emitirTicketWsNative(
  session: NativeSessionIdentity,
  metadata: NativeClientMetadata,
  config: RuntimeConfig = cargarConfiguracionRuntime(),
): Promise<NativeWsTicketIssued> {
  const rawTicket = generarTokenNativo("ws-ticket");
  const ticketHash = hmacTokenNativo(
    rawTicket,
    config.nativeAuth.hmacSecret,
    "ws-ticket",
  );
  const { rows } = await myPool.query<{ expires_at: Date }>(
    `INSERT INTO ticket_ws_nativo (
       id_sesion_nativa, ticket_hash, platform, app_build_emitido, expires_at
     ) VALUES (
       $1, $2, $3, $4, now() + make_interval(secs => $5)
     )
     RETURNING expires_at`,
    [
      session.idSesionNativa,
      ticketHash,
      metadata.platform,
      metadata.appBuild,
      config.nativeAuth.wsTicketTtlSeconds,
    ],
  );
  const ticket = rows[0];
  if (!ticket) throw new Error("No se pudo emitir el ticket WebSocket native");
  return { ticket: rawTicket, expiresAt: ticket.expires_at };
}

/**
 * Redeems a WS ticket in one PostgreSQL UPDATE. The parent session is checked
 * in the same transaction and locked before commit, so a concurrent logout
 * cannot leave a newly accepted socket attached to a revoked session.
 */
export async function consumirTicketWsNative(
  rawTicket: string,
  config: RuntimeConfig = cargarConfiguracionRuntime(),
): Promise<NativeWsConnectionIdentity | null> {
  if (!tokenNativoBienFormado(rawTicket, "ws-ticket")) return null;
  const ticketHash = hmacTokenNativo(rawTicket, config.nativeAuth.hmacSecret, "ws-ticket");
  const client = await myPool.connect();
  let discardClient = false;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      id_ticket_ws_nativo: string | number;
      id_sesion_nativa: string | number;
      id_usuario: string | number;
      platform: NativePlatform;
      app_build_emitido: string | number;
      version_sesion_emitida: string | number;
    }>(
      `UPDATE ticket_ws_nativo AS t
          SET used_at = now()
        FROM sesion_nativa AS s
        JOIN usuario AS u ON u.id_usuario = s.id_usuario
       WHERE t.ticket_hash = $1
         AND t.used_at IS NULL
         AND t.expires_at > now()
         AND t.id_sesion_nativa = s.id_sesion_nativa
         AND t.platform = s.platform
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND u.activo = TRUE
         AND u.cuenta_acceso = TRUE
         AND u.password IS NOT NULL
         AND s.version_sesion_emitida = u.version_sesion
         AND t.app_build_emitido >= CASE
           WHEN s.platform = 'android' THEN $2::integer
           ELSE $3::integer
         END
       RETURNING t.id_ticket_ws_nativo, s.id_sesion_nativa, u.id_usuario,
                 t.platform, t.app_build_emitido, s.version_sesion_emitida`,
      [ticketHash, config.nativeAuth.minAndroidBuild, config.nativeAuth.minIosBuild],
    );
    const row = rows[0];
    const idSesionNativa = numeroEntero(row?.id_sesion_nativa);
    const idUsuario = numeroEntero(row?.id_usuario);
    const versionSesionEmitida = numeroEntero(row?.version_sesion_emitida);
    const appBuildEmitido = numeroEntero(row?.app_build_emitido);
    if (
      !row || idSesionNativa === null || idUsuario === null ||
      versionSesionEmitida === null || appBuildEmitido === null
    ) {
      await client.query("ROLLBACK");
      return null;
    }

    // Re-read under row locks after the atomic claim. This closes the gap
    // between ticket claim and parent-session revocation.
    const parent = await client.query<{
      id_sesion_nativa: string | number;
      id_usuario: string | number;
      version_sesion_emitida: string | number;
      platform: NativePlatform;
      app_build_at_login: string | number;
      expires_at: Date;
      activo: boolean;
      cuenta_acceso: boolean;
      version_sesion: string | number;
    }>(
      `SELECT s.id_sesion_nativa, s.id_usuario, s.version_sesion_emitida,
              s.platform, s.app_build_at_login, s.expires_at,
              u.activo, u.cuenta_acceso, u.version_sesion
         FROM sesion_nativa AS s
         JOIN usuario AS u ON u.id_usuario = s.id_usuario
        WHERE s.id_sesion_nativa = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
        FOR UPDATE OF s, u`,
      [idSesionNativa],
    );
    const current = parent.rows[0];
    const currentVersion = numeroEntero(current?.version_sesion);
    if (
      !current || Number(current.id_usuario) !== idUsuario ||
      Number(current.version_sesion_emitida) !== versionSesionEmitida ||
      current.platform !== row.platform || !current.activo ||
      !current.cuenta_acceso || currentVersion !== versionSesionEmitida ||
      Number(row.app_build_emitido) < (
        row.platform === "android" ? config.nativeAuth.minAndroidBuild : config.nativeAuth.minIosBuild
      )
    ) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("COMMIT");
    return {
      idSesionNativa,
      idUsuario,
      versionSesionEmitida,
      platform: row.platform,
      appBuildEmitido,
    };
  } catch (error) {
    discardClient = !(await rollbackSeguro(client));
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function validarSesionNativeParaWebsocket(
  identity: NativeWsConnectionIdentity,
  config: RuntimeConfig = cargarConfiguracionRuntime(),
): Promise<boolean> {
  const { rows } = await myPool.query<{
    id_usuario: string | number;
    version_sesion_emitida: string | number;
    platform: NativePlatform;
    expires_at: Date;
    activo: boolean;
    cuenta_acceso: boolean;
    version_sesion: string | number;
  }>(
    `SELECT s.id_usuario, s.version_sesion_emitida, s.platform, s.expires_at,
            u.activo, u.cuenta_acceso, u.version_sesion
       FROM sesion_nativa AS s
       JOIN usuario AS u ON u.id_usuario = s.id_usuario
      WHERE s.id_sesion_nativa = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      LIMIT 1`,
    [identity.idSesionNativa],
  );
  const row = rows[0];
  const version = numeroEntero(row?.version_sesion);
  return Boolean(
    row && Number(row.id_usuario) === identity.idUsuario &&
    Number(row.version_sesion_emitida) === identity.versionSesionEmitida &&
    row.platform === identity.platform && row.activo && row.cuenta_acceso &&
    version === identity.versionSesionEmitida &&
    identity.appBuildEmitido >= (
      identity.platform === "android" ? config.nativeAuth.minAndroidBuild : config.nativeAuth.minIosBuild
    ),
  );
}
