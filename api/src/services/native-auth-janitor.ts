import type { QueryResult } from "pg";
import { myPool } from "../db/pool.ts";
import type { RuntimeConfig } from "../config/runtime.ts";

export interface NativeJanitorDb {
  query(text: string, values?: unknown[]): Promise<Pick<QueryResult, "rowCount">>;
}

export interface NativeJanitorLogger {
  info(data: object, message: string): void;
  warn(data: object, message: string): void;
  error(data: object, message: string): void;
}

export interface NativeJanitorStatus {
  initialSweepComplete: boolean;
  degraded: boolean;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
}

export class NativeAuthJanitor {
  private readonly db: NativeJanitorDb;
  private readonly config: Pick<RuntimeConfig, "nativeAuth">;
  private readonly logger: NativeJanitorLogger;
  private timer: NodeJS.Timeout | null = null;
  private continuation: NodeJS.Immediate | null = null;
  private running = false;
  private started = false;
  private stopped = false;
  readonly status: NativeJanitorStatus = {
    initialSweepComplete: false,
    degraded: false,
    consecutiveFailures: 0,
    lastSuccessAt: null,
  };

  constructor(
    db: NativeJanitorDb,
    config: Pick<RuntimeConfig, "nativeAuth">,
    logger: NativeJanitorLogger,
  ) {
    this.db = db;
    this.config = config;
    this.logger = logger;
  }

  isReady(): boolean {
    return this.status.initialSweepComplete && !this.status.degraded;
  }

  canEmitWsTickets(): boolean {
    return this.isReady();
  }

  async sweep(): Promise<{ ticketsDeleted: number; sessionsDeleted: number; hasBacklog: boolean }> {
    const batch = this.config.nativeAuth.janitorBatchSize;
    const tickets = await this.db.query(
      `WITH elegibles AS (
         SELECT id_ticket_ws_nativo
           FROM ticket_ws_nativo
          WHERE expires_at < now() - make_interval(mins => $1)
          ORDER BY expires_at ASC, id_ticket_ws_nativo ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       DELETE FROM ticket_ws_nativo AS t
        USING elegibles
        WHERE t.id_ticket_ws_nativo = elegibles.id_ticket_ws_nativo`,
      [this.config.nativeAuth.wsTicketRetentionMinutes, batch],
    );
    const sessions = await this.db.query(
      `WITH elegibles AS (
         SELECT id_sesion_nativa
           FROM sesion_nativa
          WHERE (
            revoked_at IS NOT NULL
            AND revoked_at < now() - make_interval(days => $1)
          ) OR (
            revoked_at IS NULL
            AND expires_at < now() - make_interval(days => $1)
          )
          ORDER BY COALESCE(revoked_at, expires_at) ASC, id_sesion_nativa ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       DELETE FROM sesion_nativa AS s
        USING elegibles
        WHERE s.id_sesion_nativa = elegibles.id_sesion_nativa`,
      [this.config.nativeAuth.sessionRetentionDays, batch],
    );
    const ticketsDeleted = tickets.rowCount ?? 0;
    const sessionsDeleted = sessions.rowCount ?? 0;
    return {
      ticketsDeleted,
      sessionsDeleted,
      hasBacklog: ticketsDeleted === batch || sessionsDeleted === batch,
    };
  }

  private async runSafely(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const result = await this.sweep();
      this.status.initialSweepComplete = true;
      this.status.consecutiveFailures = 0;
      this.status.degraded = false;
      this.status.lastSuccessAt = new Date();
      this.logger.info(
        {
          event: "native_auth_janitor_completed",
          tickets_deleted: result.ticketsDeleted,
          sessions_deleted: result.sessionsDeleted,
          backlog: result.hasBacklog,
        },
        "Limpieza native completada",
      );
      if (result.hasBacklog && !this.stopped && this.continuation === null) {
        this.continuation = setImmediate(() => {
          this.continuation = null;
          void this.runSafely();
        });
        this.continuation.unref();
      }
    } catch (error) {
      this.status.consecutiveFailures += 1;
      if (
        !this.status.initialSweepComplete ||
        this.status.consecutiveFailures >= this.config.nativeAuth.janitorFailureThreshold
      ) this.status.degraded = true;
      this.logger.error(
        {
          event: "native_auth_janitor_failed",
          err: error,
          consecutive_failures: this.status.consecutiveFailures,
          degraded: this.status.degraded,
        },
        "Falló la limpieza native; se reintentará",
      );
    } finally {
      this.running = false;
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    await this.runSafely();
    if (this.stopped) return;
    this.timer = setInterval(
      () => void this.runSafely(),
      this.config.nativeAuth.janitorIntervalSeconds * 1_000,
    );
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.continuation) clearImmediate(this.continuation);
    this.timer = null;
    this.continuation = null;
  }
}

let activeJanitor: NativeAuthJanitor | null = null;

export const nativeAuthJanitorHealth = {
  isReady(): boolean {
    return activeJanitor?.isReady() ?? false;
  },
  canEmitWsTickets(): boolean {
    return activeJanitor?.canEmitWsTickets() ?? false;
  },
};

export function registrarNativeAuthJanitor(
  janitor: NativeAuthJanitor | null,
): void {
  activeJanitor = janitor;
}

export function crearNativeAuthJanitor(
  config: Pick<RuntimeConfig, "nativeAuth">,
  logger: NativeJanitorLogger,
  db: NativeJanitorDb = myPool,
): NativeAuthJanitor {
  return new NativeAuthJanitor(db, config, logger);
}
