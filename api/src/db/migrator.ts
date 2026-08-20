import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const ARCHIVO_MIGRACION = /^(\d{3})_([a-z0-9_]+)\.sql$/;
const BASELINE_EXISTENTE_HASTA = "005";
const LOCK_CLASE = 707;
const LOCK_OBJETO = 3;

export interface Migracion {
  version: string;
  nombre: string;
  archivo: string;
  checksum: string;
  checksumsLegacy: string[];
  sql: string;
}

export interface MigracionAplicada {
  version: string;
  nombre: string;
  checksum_sha256: string;
}

export interface OpcionesMigracion {
  directorio?: string;
  adoptarEsquemaActual?: boolean;
  lockTimeoutMs?: number;
  logger?: (mensaje: string) => void;
}

export interface ResultadoMigracion {
  aplicadas: string[];
  pendientes: number;
  adoptoBaseline: boolean;
}

export const DIRECTORIO_MIGRACIONES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "db",
  "migrations",
);

export function checksumSha256(contenido: string | Uint8Array): string {
  return createHash("sha256").update(contenido).digest("hex");
}

export function normalizarSaltosLineaSQL(contenido: string): string {
  return contenido.replace(/\r\n?/g, "\n");
}

export function checksumMigracion(contenido: string): string {
  return checksumSha256(normalizarSaltosLineaSQL(contenido));
}

export function checksumsLegacyMigracion(contenido: string): string[] {
  const canonico = normalizarSaltosLineaSQL(contenido);
  const checksumCanonico = checksumSha256(canonico);
  const checksumCrlf = checksumSha256(canonico.replace(/\n/g, "\r\n"));
  return checksumCrlf === checksumCanonico ? [] : [checksumCrlf];
}

export function checksumMigracionAplicadaValido(migracion: Migracion, checksum: string): boolean {
  const registrado = checksum.trim();
  return migracion.checksum === registrado || migracion.checksumsLegacy.includes(registrado);
}

export async function leerMigraciones(directorio = DIRECTORIO_MIGRACIONES): Promise<Migracion[]> {
  const entradas = await fs.readdir(directorio, { withFileTypes: true });
  const archivos = entradas.filter((x) => x.isFile() && ARCHIVO_MIGRACION.test(x.name)).map((x) => x.name).sort();
  if (!archivos.length) throw new Error("No se encontraron migraciones SQL");

  const versiones = new Set<string>();
  const migraciones: Migracion[] = [];
  for (const archivo of archivos) {
    const coincidencia = ARCHIVO_MIGRACION.exec(archivo)!;
    const version = coincidencia[1];
    if (versiones.has(version)) throw new Error(`Versión de migración duplicada: ${version}`);
    versiones.add(version);
    const bytes = await fs.readFile(path.join(directorio, archivo));
    const contenido = bytes.toString("utf8");
    const sql = normalizarSaltosLineaSQL(contenido);
    if (/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql))
      throw new Error(`La migración ${archivo} no debe controlar su propia transacción`);
    if (/^\s*\\/m.test(sql)) throw new Error(`La migración ${archivo} contiene comandos exclusivos de psql`);
    migraciones.push({
      version,
      nombre: coincidencia[2],
      archivo,
      checksum: checksumMigracion(contenido),
      checksumsLegacy: checksumsLegacyMigracion(contenido),
      sql,
    });
  }
  return migraciones;
}

async function tomarLock(client: PoolClient, timeoutMs: number): Promise<void> {
  const limite = Date.now() + timeoutMs;
  do {
    const { rows } = await client.query<{ obtenido: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS obtenido",
      [LOCK_CLASE, LOCK_OBJETO],
    );
    if (rows[0]?.obtenido) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < limite);
  throw new Error("No se pudo obtener el lock de migraciones dentro del timeout");
}

async function soltarLock(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_CLASE, LOCK_OBJETO]);
}

async function existeLedger(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ existe: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS existe",
  );
  return rows[0]?.existe === true;
}

async function tablasAplicacion(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations' ORDER BY tablename",
  );
  return rows.map((x) => x.tablename);
}

async function crearLedger(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE public.schema_migrations (
      version VARCHAR(3) PRIMARY KEY CHECK (version ~ '^[0-9]{3}$'),
      nombre VARCHAR(160) NOT NULL UNIQUE,
      checksum_sha256 CHAR(64) NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function verificarEsquemaBaseline(client: PoolClient): Promise<string[]> {
  const errores: string[] = [];
  const tablasRequeridas = [
    "catalogo_litologia", "documento", "informe", "intervalo_diametro_perforacion",
    "intervalo_filtro", "intervalo_litologico", "nivel_aporte", "permiso", "pozo",
    "rol", "rol_permiso", "sitio", "usuario", "usuario_rol",
  ];
  const presentes = new Set(await tablasAplicacion(client));
  for (const tabla of tablasRequeridas) if (!presentes.has(tabla)) errores.push(`falta tabla ${tabla}`);
  if (errores.length) return errores;

  const { rows: columnas } = await client.query<{
    table_name: string; column_name: string; is_nullable: string; udt_name: string; column_default: string | null;
  }>(`
    SELECT table_name,column_name,is_nullable,udt_name,column_default
    FROM information_schema.columns
    WHERE table_schema='public'
      AND (table_name,column_name) IN (
        ('usuario','email'),('usuario','password'),('usuario','cuenta_acceso'),('usuario','version_sesion'),
        ('intervalo_diametro_perforacion','material_tuberia'),('intervalo_filtro','ranura_mm'),
        ('intervalo_litologico','id_litologia')
      )
  `);
  const porColumna = new Map(columnas.map((x) => [`${x.table_name}.${x.column_name}`, x]));
  for (const columna of [
    "usuario.email", "usuario.password", "usuario.cuenta_acceso", "usuario.version_sesion",
    "intervalo_diametro_perforacion.material_tuberia", "intervalo_filtro.ranura_mm",
    "intervalo_litologico.id_litologia",
  ]) if (!porColumna.has(columna)) errores.push(`falta columna ${columna}`);

  const email = porColumna.get("usuario.email");
  const password = porColumna.get("usuario.password");
  const cuenta = porColumna.get("usuario.cuenta_acceso");
  const version = porColumna.get("usuario.version_sesion");
  if (email && (email.udt_name !== "citext" || email.is_nullable !== "YES")) errores.push("usuario.email no coincide");
  if (password?.is_nullable !== "YES") errores.push("usuario.password debe aceptar NULL");
  if (cuenta && (cuenta.is_nullable !== "NO" || !cuenta.column_default?.toLowerCase().includes("true")))
    errores.push("usuario.cuenta_acceso no coincide");
  if (version && (version.is_nullable !== "NO" || !version.column_default?.includes("1")))
    errores.push("usuario.version_sesion no coincide");

  const { rows: objetos } = await client.query<{
    funcion: boolean; indice_litologia: boolean; indice_filtro: boolean;
  }>(`
    SELECT
      to_regprocedure('public.litologia_normalizar(text)') IS NOT NULL AS funcion,
      to_regclass('public.intervalo_litologico_id_litologia_idx') IS NOT NULL AS indice_litologia,
      to_regclass('public.intervalo_filtro_pozo_profundidad_idx') IS NOT NULL AS indice_filtro
  `);
  if (!objetos[0]?.funcion) errores.push("falta función litologia_normalizar");
  if (!objetos[0]?.indice_litologia) errores.push("falta índice litológico");
  if (!objetos[0]?.indice_filtro) errores.push("falta índice de filtros");

  const { rows: constraints } = await client.query<{ definicion: string }>(`
    SELECT pg_get_constraintdef(oid) AS definicion
    FROM pg_constraint
    WHERE connamespace='public'::regnamespace
      AND conrelid IN ('public.usuario'::regclass,'public.intervalo_filtro'::regclass,'public.intervalo_litologico'::regclass)
  `);
  const definiciones = constraints.map((x) => x.definicion.toLowerCase()).join("\n");
  if (!/check \(\(version_sesion > 0\)\)/.test(definiciones)) errores.push("falta check de version_sesion");
  if (!definiciones.includes("ranura_mm") || !definiciones.includes("0.75")) errores.push("falta check de ranura_mm");
  if (!definiciones.includes("foreign key (id_litologia)")) errores.push("falta FK de catálogo litológico");

  const codigosEsperados = [
    "basalto_marron", "basalto_marron_rojizo", "basalto_gris_oscuro", "basalto_negro", "basalto_fracturado",
    "suelo_organico", "arenisca_rosada", "arenisca_rojiza", "arenisca_blanca", "arenisca_fina",
    "arenisca_media", "arenisca_gruesa", "arcilla_roja", "arcilla_marron", "arcilla_gris", "arena_arcillosa",
    "arcilla_negra", "arcilla_rosada", "tosca_rosada", "tosca_blanca", "tosca_amarilla", "tosca_marron",
    "tosca_rojiza", "tosca_compacta", "gravilla_fina", "gravilla_gruesa", "granito_rosado", "granito_blanco",
    "granito_gris",
  ];
  const { rows: catalogo } = await client.query<{ codigo: string }>(
    "SELECT codigo FROM public.catalogo_litologia WHERE es_inicial=TRUE",
  );
  const existentes = new Set(catalogo.map((x) => x.codigo));
  if (catalogo.length !== codigosEsperados.length || existentes.size !== codigosEsperados.length)
    errores.push("el conjunto de litologías iniciales no coincide");
  for (const codigo of codigosEsperados) if (!existentes.has(codigo)) errores.push(`falta litología inicial ${codigo}`);
  return errores;
}

async function adoptarBaseline(client: PoolClient, migraciones: Migracion[]): Promise<void> {
  const baseline = migraciones.filter((x) => x.version <= BASELINE_EXISTENTE_HASTA);
  const esperadas = ["000", "001", "002", "003", "004", "005"];
  if (baseline.map((x) => x.version).join(",") !== esperadas.join(","))
    throw new Error("El conjunto de migraciones no contiene el baseline 000..005 esperado");
  const errores = await verificarEsquemaBaseline(client);
  if (errores.length) throw new Error(`No se puede adoptar el esquema: ${errores.join("; ")}`);

  await client.query("BEGIN");
  try {
    await crearLedger(client);
    for (const migracion of baseline) {
      await client.query(
        "INSERT INTO public.schema_migrations(version,nombre,checksum_sha256) VALUES($1,$2,$3)",
        [migracion.version, migracion.nombre, migracion.checksum],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function leerAplicadas(client: PoolClient): Promise<MigracionAplicada[]> {
  const { rows } = await client.query<MigracionAplicada>(
    "SELECT version,nombre,checksum_sha256 FROM public.schema_migrations ORDER BY version",
  );
  return rows;
}

function validarLedger(aplicadas: MigracionAplicada[], migraciones: Migracion[]): void {
  const locales = new Map(migraciones.map((x) => [x.version, x]));
  for (const aplicada of aplicadas) {
    const local = locales.get(aplicada.version);
    if (!local) throw new Error(`La base registra una migración desconocida para esta imagen: ${aplicada.version}`);
    if (local.nombre !== aplicada.nombre) throw new Error(`El nombre de la migración ${aplicada.version} no coincide`);
    if (!checksumMigracionAplicadaValido(local, aplicada.checksum_sha256))
      throw new Error(`Checksum diferente para la migración ya aplicada ${aplicada.version}_${aplicada.nombre}`);
  }
}

export async function ejecutarMigraciones(pool: Pick<Pool, "connect">, opciones: OpcionesMigracion = {}): Promise<ResultadoMigracion> {
  const migraciones = await leerMigraciones(opciones.directorio);
  const logger = opciones.logger ?? ((mensaje: string) => console.log(mensaje));
  const client = await pool.connect();
  let lockTomado = false;
  let errorPrincipal: unknown;
  let adoptoBaseline = false;
  const aplicadasAhora: string[] = [];
  try {
    await tomarLock(client, opciones.lockTimeoutMs ?? 30_000);
    lockTomado = true;
    let ledger = await existeLedger(client);
    if (!ledger) {
      const tablas = await tablasAplicacion(client);
      if (tablas.length) {
        if (!opciones.adoptarEsquemaActual)
          throw new Error("La base contiene un esquema sin ledger; use --adopt-current-schema tras verificar su procedencia");
        await adoptarBaseline(client, migraciones);
        adoptoBaseline = true;
      } else {
        await client.query("BEGIN");
        try { await crearLedger(client); await client.query("COMMIT"); }
        catch (error) { await client.query("ROLLBACK"); throw error; }
      }
      ledger = true;
    }

    const registradas = await leerAplicadas(client);
    validarLedger(registradas, migraciones);
    const versionesAplicadas = new Set(registradas.map((x) => x.version));
    const pendientes = migraciones.filter((x) => !versionesAplicadas.has(x.version));
    for (const migracion of pendientes) {
      await client.query("BEGIN");
      try {
        await client.query(migracion.sql);
        await client.query(
          "INSERT INTO public.schema_migrations(version,nombre,checksum_sha256) VALUES($1,$2,$3)",
          [migracion.version, migracion.nombre, migracion.checksum],
        );
        await client.query("COMMIT");
        aplicadasAhora.push(migracion.archivo);
        logger(`Migración aplicada: ${migracion.archivo}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Falló la migración ${migracion.archivo}`, { cause: error });
      }
    }

    const errores = await verificarEsquemaBaseline(client);
    if (errores.length) throw new Error(`El esquema final no pasó la verificación: ${errores.join("; ")}`);
    if (!pendientes.length) logger("Migraciones al día; no hay cambios pendientes.");
    return { aplicadas: aplicadasAhora, pendientes: 0, adoptoBaseline };
  } catch (error) {
    errorPrincipal = error;
    throw error;
  } finally {
    let errorUnlock: unknown;
    try {
      if (lockTomado) await soltarLock(client);
    } catch (error) {
      errorUnlock = error;
      if (errorPrincipal !== undefined) {
        try { logger("Falló la liberación del lock de migraciones después de un error principal."); }
        catch { /* logging best effort: release y error principal tienen prioridad */ }
      }
      else throw error;
    } finally {
      client.release(errorUnlock instanceof Error ? errorUnlock : errorUnlock === undefined ? undefined : true);
    }
  }
}
