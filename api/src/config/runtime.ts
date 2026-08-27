import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface RuntimeConfig {
  nodeEnv: string;
  production: boolean;
  apiPort: number;
  appVersion: string;
  gitSha: string;
  fotosDir: string;
  fastifySecret?: string;
  publicHost?: string;
  publicOrigin?: string;
  trustProxy: false | 1;
  corsOrigins: string[];
  nativeCorsOrigins: string[];
  enableApiDocs: boolean;
  hstsEnabled: boolean;
  logLevel: string;
  rateLimits: {
    api: number;
    login: number;
    maps: number;
    pdf: number;
    upload: number;
    nativeWsTicket: number;
  };
  nativeAuth: {
    hmacSecret: string;
    sessionTtlDays: number;
    sessionRetentionDays: number;
    maxActiveSessionsPerUser: number;
    minAndroidBuild: number;
    minIosBuild: number;
    wsTicketTtlSeconds: number;
    wsTicketRetentionMinutes: number;
    janitorIntervalSeconds: number;
    janitorBatchSize: number;
    janitorFailureThreshold: number;
  };
  pdf: {
    maxConcurrent: number;
    maxQueue: number;
    queueTimeoutMs: number;
  };
  postgres: {
    user?: string;
    password?: string;
    host?: string;
    port: number;
    database?: string;
    poolMax: number;
    connectionTimeoutMs: number;
    statementTimeoutMs: number;
    idleTransactionTimeoutMs: number;
    queryTimeoutMs: number;
  };
}

const DEFAULT_FOTOS_DIR = path.join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
);

const DEV_CORS_ORIGINS = [
  "http://localhost:4200",
  "https://localhost:4200",
  "https://localhost",
];

const NATIVE_CORS_ORIGINS = ["https://localhost", "capacitor://localhost"];
const DEVELOPMENT_NATIVE_HMAC_SECRET =
  "development-only-native-hmac-secret-change-before-production";

const SECRETOS_TRIVIALES = new Set([
  "secret",
  "changeme",
  "change_me",
  "change_this_with_a_long_random_secret",
]);

function valor(env: NodeJS.ProcessEnv, nombre: string): string | undefined {
  const resultado = env[nombre]?.trim();
  return resultado || undefined;
}

function requerido(env: NodeJS.ProcessEnv, nombre: string): string {
  const resultado = valor(env, nombre);
  if (!resultado) throw new Error(`Falta configurar ${nombre}`);
  return resultado;
}

function secreto(env: NodeJS.ProcessEnv, nombre: string): string | undefined {
  const resultado = env[nombre];
  return resultado === undefined || resultado.length === 0 ? undefined : resultado;
}

function secretoRequerido(env: NodeJS.ProcessEnv, nombre: string): string {
  const resultado = secreto(env, nombre);
  if (resultado === undefined) throw new Error(`Falta configurar ${nombre}`);
  return resultado;
}

function puerto(nombre: string, entrada: string | undefined, porDefecto?: number): number {
  if (!entrada && porDefecto !== undefined) return porDefecto;
  if (!entrada || !/^\d+$/.test(entrada)) throw new Error(`${nombre} debe ser un puerto válido`);
  const resultado = Number(entrada);
  if (!Number.isSafeInteger(resultado) || resultado < 1 || resultado > 65_535)
    throw new Error(`${nombre} debe ser un puerto válido`);
  return resultado;
}

function entero(
  nombre: string,
  entrada: string | undefined,
  porDefecto: number,
  minimo: number,
  maximo: number,
): number {
  if (!entrada) return porDefecto;
  if (!/^\d+$/.test(entrada)) throw new Error(`${nombre} debe ser un entero vÃ¡lido`);
  const resultado = Number(entrada);
  if (!Number.isSafeInteger(resultado) || resultado < minimo || resultado > maximo)
    throw new Error(`${nombre} debe estar entre ${minimo} y ${maximo}`);
  return resultado;
}

function enteroRequerido(
  env: NodeJS.ProcessEnv,
  nombre: string,
  production: boolean,
  porDefectoDesarrollo: number,
  minimo: number,
  maximo: number,
): number {
  const entrada = valor(env, nombre);
  if (production && entrada === undefined) throw new Error(`Falta configurar ${nombre}`);
  return entero(nombre, entrada, porDefectoDesarrollo, minimo, maximo);
}

function booleano(nombre: string, entrada: string | undefined, porDefecto: boolean): boolean {
  if (!entrada) return porDefecto;
  if (entrada === "true") return true;
  if (entrada === "false") return false;
  throw new Error(`${nombre} debe ser true o false`);
}

function validarDominioPublico(env: NodeJS.ProcessEnv, production: boolean): { host?: string; origin?: string } {
  if (!production) return {};
  const hostIngresado = requerido(env, "PUBLIC_HOST");
  const host = hostIngresado.toLowerCase();
  if (
    hostIngresado !== host || host.length > 253 || host.includes("*") || host === "localhost" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
  ) throw new Error("PUBLIC_HOST debe ser un hostname DNS concreto sin wildcard");

  const entrada = requerido(env, "PUBLIC_ORIGIN").replace(/\/$/, "");
  let url: URL;
  try { url = new URL(entrada); }
  catch { throw new Error("PUBLIC_ORIGIN debe ser un origin HTTPS válido"); }
  if (
    url.protocol !== "https:" || url.origin !== entrada || url.hostname.toLowerCase() !== host ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) throw new Error("PUBLIC_ORIGIN debe ser HTTPS y coincidir con PUBLIC_HOST sin ruta");
  return { host, origin: url.origin };
}

export function normalizarOriginsPermitidos(entrada: string | undefined, production: boolean, publicOrigin?: string): string[] {
  if (!entrada) return production ? [publicOrigin!] : DEV_CORS_ORIGINS;
  const origins = entrada.split(",").map((item) => {
    const candidato = item.trim();
    let url: URL;
    try { url = new URL(candidato); }
    catch { throw new Error("CORS_ORIGINS contiene un origin inválido"); }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== candidato.replace(/\/$/, ""))
      throw new Error("CORS_ORIGINS debe contener origins HTTP(S) sin rutas");
    if (production && (url.protocol !== "https:" || url.hostname === "localhost" || url.hostname.endsWith(".localhost")))
      throw new Error("CORS_ORIGINS de producción solo admite origins HTTPS no locales");
    return url.origin;
  });
  return [...new Set(production ? [publicOrigin!, ...origins] : origins)];
}

export function normalizarOriginsNative(entrada: string | undefined): string[] {
  if (!entrada) return [...NATIVE_CORS_ORIGINS];
  const permitidos = new Set(NATIVE_CORS_ORIGINS);
  const origins = entrada.split(",").map((item) => item.trim());
  if (origins.some((origin) => !permitidos.has(origin))) {
    throw new Error(
      "NATIVE_CORS_ORIGINS sólo admite https://localhost y capacitor://localhost",
    );
  }
  return [...new Set(origins)];
}

function validarMapasProduccion(env: NodeJS.ProcessEnv): void {
  const plantilla = requerido(env, "MAP_STATIC_URL_TEMPLATE");
  const host = requerido(env, "MAP_STATIC_ALLOWED_HOST").toLowerCase();
  requerido(env, "MAP_STATIC_API_KEY");
  requerido(env, "MAP_STATIC_ATTRIBUTION");

  if (!plantilla.includes("{latitud}") && !plantilla.includes("{lat}"))
    throw new Error("MAP_STATIC_URL_TEMPLATE debe incluir latitud");
  if (!plantilla.includes("{longitud}") && !plantilla.includes("{lon}"))
    throw new Error("MAP_STATIC_URL_TEMPLATE debe incluir longitud");
  if (!plantilla.includes("{apiKey}") && !plantilla.includes("{key}"))
    throw new Error("MAP_STATIC_URL_TEMPLATE debe incluir el marcador de API key");

  let url: URL;
  try {
    url = new URL(
      plantilla
        .replaceAll("{latitud}", "0").replaceAll("{lat}", "0")
        .replaceAll("{longitud}", "0").replaceAll("{lon}", "0")
        .replaceAll("{apiKey}", "validacion").replaceAll("{key}", "validacion"),
    );
  } catch {
    throw new Error("MAP_STATIC_URL_TEMPLATE debe ser una URL válida");
  }
  if (url.protocol !== "https:") throw new Error("MAP_STATIC_URL_TEMPLATE debe usar HTTPS");
  if (url.hostname.toLowerCase() !== host || url.username || url.password)
    throw new Error("MAP_STATIC_ALLOWED_HOST no coincide con la plantilla de Maps");
}

export function cargarConfiguracionRuntime(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const nodeEnv = valor(env, "NODE_ENV") ?? "development";
  const production = nodeEnv === "production";
  const publico = validarDominioPublico(env, production);
  const apiPort = puerto("API_PORT", valor(env, "API_PORT"), production ? undefined : 3000);
  const fotosDir = valor(env, "FOTOS_DIR") ?? (production ? requerido(env, "FOTOS_DIR") : DEFAULT_FOTOS_DIR);

  if (production && !path.isAbsolute(fotosDir))
    throw new Error("FOTOS_DIR debe ser una ruta absoluta en producción");

  const fastifySecret = production ? requerido(env, "FASTIFY_SECRET") : valor(env, "FASTIFY_SECRET");
  if (production && fastifySecret && (fastifySecret.length < 32 || SECRETOS_TRIVIALES.has(fastifySecret.toLowerCase())))
    throw new Error("FASTIFY_SECRET debe ser aleatorio y tener al menos 32 caracteres");

  const nativeHmacSecret = production
    ? secretoRequerido(env, "NATIVE_TOKEN_HMAC_SECRET")
    : secreto(env, "NATIVE_TOKEN_HMAC_SECRET") ?? DEVELOPMENT_NATIVE_HMAC_SECRET;
  if (
    nativeHmacSecret.length < 32 ||
    SECRETOS_TRIVIALES.has(nativeHmacSecret.toLowerCase()) ||
    nativeHmacSecret === fastifySecret
  ) {
    throw new Error(
      "NATIVE_TOKEN_HMAC_SECRET debe ser independiente, aleatorio y tener al menos 32 caracteres",
    );
  }

  if (production) validarMapasProduccion(env);

  const enableApiDocs = booleano("ENABLE_API_DOCS", valor(env, "ENABLE_API_DOCS"), !production);
  if (production && enableApiDocs)
    throw new Error("ENABLE_API_DOCS no puede habilitarse en producciÃ³n");
  const hstsEnabled = booleano("HSTS_ENABLED", valor(env, "HSTS_ENABLED"), false);
  if (!production && hstsEnabled)
    throw new Error("HSTS_ENABLED solo puede activarse en producciÃ³n con TLS pÃºblico estable");

  const connectionTimeoutMs = entero("PG_CONNECTION_TIMEOUT_MS", valor(env, "PG_CONNECTION_TIMEOUT_MS"), 5_000, 100, 60_000);
  const statementTimeoutMs = entero("PG_STATEMENT_TIMEOUT_MS", valor(env, "PG_STATEMENT_TIMEOUT_MS"), 30_000, 1_000, 300_000);
  const queryTimeoutMs = entero("PG_QUERY_TIMEOUT_MS", valor(env, "PG_QUERY_TIMEOUT_MS"), 35_000, 1_000, 310_000);
  if (queryTimeoutMs < statementTimeoutMs)
    throw new Error("PG_QUERY_TIMEOUT_MS no puede ser menor que PG_STATEMENT_TIMEOUT_MS");

  const wsTicketTtlSeconds = entero(
    "NATIVE_WS_TICKET_TTL_SECONDS",
    valor(env, "NATIVE_WS_TICKET_TTL_SECONDS"),
    30,
    5,
    300,
  );
  const wsTicketRetentionMinutes = entero(
    "NATIVE_WS_TICKET_RETENTION_MINUTES",
    valor(env, "NATIVE_WS_TICKET_RETENTION_MINUTES"),
    60,
    1,
    10_080,
  );
  if (wsTicketRetentionMinutes * 60 <= wsTicketTtlSeconds) {
    throw new Error(
      "NATIVE_WS_TICKET_RETENTION_MINUTES debe superar NATIVE_WS_TICKET_TTL_SECONDS",
    );
  }

  return {
    nodeEnv,
    production,
    apiPort,
    appVersion: valor(env,"APP_VERSION")??"unknown",
    gitSha: valor(env,"GIT_SHA")??"unknown",
    fotosDir: path.resolve(fotosDir),
    fastifySecret,
    publicHost: publico.host,
    publicOrigin: publico.origin,
    trustProxy: production ? 1 : false,
    corsOrigins: normalizarOriginsPermitidos(valor(env, "CORS_ORIGINS"), production, publico.origin),
    nativeCorsOrigins: normalizarOriginsNative(valor(env, "NATIVE_CORS_ORIGINS")),
    enableApiDocs,
    hstsEnabled,
    logLevel: valor(env, "LOG_LEVEL") ?? (production ? "info" : "debug"),
    rateLimits: {
      api: entero("RATE_LIMIT_API_MAX", valor(env, "RATE_LIMIT_API_MAX"), 600, 10, 100_000),
      login: entero("RATE_LIMIT_LOGIN_MAX", valor(env, "RATE_LIMIT_LOGIN_MAX"), 10, 1, 10_000),
      maps: entero("RATE_LIMIT_MAP_MAX", valor(env, "RATE_LIMIT_MAP_MAX"), 30, 1, 10_000),
      pdf: entero("RATE_LIMIT_PDF_MAX", valor(env, "RATE_LIMIT_PDF_MAX"), 10, 1, 10_000),
      upload: entero("RATE_LIMIT_UPLOAD_MAX", valor(env, "RATE_LIMIT_UPLOAD_MAX"), 30, 1, 10_000),
      nativeWsTicket: entero(
        "RATE_LIMIT_NATIVE_WS_TICKET_MAX",
        valor(env, "RATE_LIMIT_NATIVE_WS_TICKET_MAX"),
        30,
        1,
        10_000,
      ),
    },
    nativeAuth: {
      hmacSecret: nativeHmacSecret,
      sessionTtlDays: entero(
        "NATIVE_SESSION_TTL_DAYS",
        valor(env, "NATIVE_SESSION_TTL_DAYS"),
        30,
        1,
        365,
      ),
      sessionRetentionDays: entero(
        "NATIVE_SESSION_RETENTION_DAYS",
        valor(env, "NATIVE_SESSION_RETENTION_DAYS"),
        30,
        1,
        365,
      ),
      maxActiveSessionsPerUser: entero(
        "NATIVE_MAX_ACTIVE_SESSIONS_PER_USER",
        valor(env, "NATIVE_MAX_ACTIVE_SESSIONS_PER_USER"),
        5,
        1,
        100,
      ),
      minAndroidBuild: enteroRequerido(
        env,
        "MIN_NATIVE_ANDROID_BUILD",
        production,
        1,
        1,
        2_147_483_647,
      ),
      minIosBuild: enteroRequerido(
        env,
        "MIN_NATIVE_IOS_BUILD",
        production,
        1,
        1,
        2_147_483_647,
      ),
      wsTicketTtlSeconds,
      wsTicketRetentionMinutes,
      janitorIntervalSeconds: entero(
        "NATIVE_AUTH_JANITOR_INTERVAL_SECONDS",
        valor(env, "NATIVE_AUTH_JANITOR_INTERVAL_SECONDS"),
        300,
        5,
        86_400,
      ),
      janitorBatchSize: entero(
        "NATIVE_AUTH_JANITOR_BATCH_SIZE",
        valor(env, "NATIVE_AUTH_JANITOR_BATCH_SIZE"),
        500,
        1,
        10_000,
      ),
      janitorFailureThreshold: entero(
        "NATIVE_AUTH_JANITOR_FAILURE_THRESHOLD",
        valor(env, "NATIVE_AUTH_JANITOR_FAILURE_THRESHOLD"),
        3,
        1,
        100,
      ),
    },
    pdf: {
      maxConcurrent: entero("PDF_MAX_CONCURRENT", valor(env, "PDF_MAX_CONCURRENT"), 2, 1, 16),
      maxQueue: entero("PDF_MAX_QUEUE", valor(env, "PDF_MAX_QUEUE"), 4, 0, 100),
      queueTimeoutMs: entero("PDF_QUEUE_TIMEOUT_MS", valor(env, "PDF_QUEUE_TIMEOUT_MS"), 15_000, 100, 120_000),
    },
    postgres: {
      user: production ? requerido(env, "PGUSER") : valor(env, "PGUSER"),
      password: production ? secretoRequerido(env, "PGPASSWORD") : secreto(env, "PGPASSWORD"),
      host: production ? requerido(env, "PGHOST") : valor(env, "PGHOST"),
      port: puerto("PGPORT", valor(env, "PGPORT"), production ? undefined : 5432),
      database: production ? requerido(env, "PGDATABASE") : valor(env, "PGDATABASE"),
      poolMax: entero("PG_POOL_MAX", valor(env, "PG_POOL_MAX"), 10, 1, 50),
      connectionTimeoutMs,
      statementTimeoutMs,
      idleTransactionTimeoutMs: entero("PG_IDLE_TRANSACTION_TIMEOUT_MS", valor(env, "PG_IDLE_TRANSACTION_TIMEOUT_MS"), 15_000, 1_000, 300_000),
      queryTimeoutMs,
    },
  };
}

export async function prepararDirectorioFotos(config: Pick<RuntimeConfig, "fotosDir">): Promise<void> {
  try {
    await fs.mkdir(config.fotosDir, { recursive: true });
    await fs.mkdir(path.join(config.fotosDir, ".trash"), { recursive: true });
    await fs.access(config.fotosDir, fsConstants.R_OK | fsConstants.W_OK);
    await fs.access(path.join(config.fotosDir, ".trash"), fsConstants.R_OK | fsConstants.W_OK);
  } catch (cause) {
    throw new Error("No se pudo preparar el almacenamiento de fotografías configurado", { cause });
  }
}
