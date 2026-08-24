import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ejecutarMigraciones } from "../src/db/migrator.ts";

const TABLAS = [
  "catalogo_litologia", "documento", "informe", "intervalo_diametro_perforacion",
  "intervalo_filtro", "intervalo_litologico", "nivel_aporte", "permiso", "pozo",
  "rol", "rol_permiso", "sitio", "usuario", "usuario_rol",
];
const CODIGOS = [
  "basalto_marron", "basalto_marron_rojizo", "basalto_gris_oscuro", "basalto_negro", "basalto_fracturado",
  "suelo_organico", "arenisca_rosada", "arenisca_rojiza", "arenisca_blanca", "arenisca_fina",
  "arenisca_media", "arenisca_gruesa", "arcilla_roja", "arcilla_marron", "arcilla_gris", "arena_arcillosa",
  "arcilla_negra", "arcilla_rosada", "tosca_rosada", "tosca_blanca", "tosca_amarilla", "tosca_marron",
  "tosca_rojiza", "tosca_compacta", "gravilla_fina", "gravilla_gruesa", "granito_rosado", "granito_blanco",
  "granito_gris",
];

interface Escenario {
  errorMigracion?: Error;
  errorUnlock?: Error;
}

class ClienteControlado {
  readonly consultas: string[] = [];
  liberado = false;
  argumentoRelease: Error | boolean | undefined;
  private readonly escenario: Escenario;

  constructor(escenario: Escenario = {}) { this.escenario = escenario; }

  async query(sql: string): Promise<{ rows: unknown[] }> {
    const normalizado = sql.trim();
    this.consultas.push(normalizado);
    if (normalizado.includes("pg_try_advisory_lock")) return { rows: [{ obtenido: true }] };
    if (normalizado.includes("pg_advisory_unlock")) {
      if (this.escenario.errorUnlock) throw this.escenario.errorUnlock;
      return { rows: [{ liberado: true }] };
    }
    if (normalizado.includes("to_regclass('public.schema_migrations')")) return { rows: [{ existe: true }] };
    if (normalizado.includes("FROM public.schema_migrations")) return { rows: [] };
    if (normalizado === "SELECT 42;") {
      if (this.escenario.errorMigracion) throw this.escenario.errorMigracion;
      return { rows: [] };
    }
    if (normalizado.includes("FROM pg_tables")) return { rows: TABLAS.map((tablename) => ({ tablename })) };
    if (normalizado.includes("FROM information_schema.columns")) return { rows: [
      { table_name: "usuario", column_name: "email", is_nullable: "YES", udt_name: "citext", column_default: null },
      { table_name: "usuario", column_name: "password", is_nullable: "YES", udt_name: "text", column_default: null },
      { table_name: "usuario", column_name: "cuenta_acceso", is_nullable: "NO", udt_name: "bool", column_default: "true" },
      { table_name: "usuario", column_name: "version_sesion", is_nullable: "NO", udt_name: "int4", column_default: "1" },
      { table_name: "intervalo_diametro_perforacion", column_name: "material_tuberia", is_nullable: "YES", udt_name: "varchar", column_default: null },
      { table_name: "intervalo_filtro", column_name: "ranura_mm", is_nullable: "YES", udt_name: "numeric", column_default: null },
      { table_name: "intervalo_litologico", column_name: "id_litologia", is_nullable: "YES", udt_name: "int4", column_default: null },
    ] };
    if (normalizado.includes("to_regprocedure('public.litologia_normalizar(text)')"))
      return { rows: [{ funcion: true, indice_litologia: true, indice_filtro: true }] };
    if (normalizado.includes("FROM pg_constraint")) return { rows: [
      { definicion: "CHECK ((version_sesion > 0)) CHECK (ranura_mm IN (0.75)) FOREIGN KEY (id_litologia)" },
    ] };
    if (normalizado.includes("FROM public.catalogo_litologia")) return { rows: CODIGOS.map((codigo) => ({ codigo })) };
    return { rows: [] };
  }

  release(error?: Error | boolean): void {
    this.liberado = true;
    this.argumentoRelease = error;
    this.consultas.push("RELEASE");
  }
}

class PoolControlado {
  ended = false;
  readonly client: ClienteControlado;
  constructor(client: ClienteControlado) { this.client = client; }
  async connect(): Promise<ClienteControlado> { return this.client; }
  async end(): Promise<void> {
    if (!this.client.liberado) await new Promise<void>(() => undefined);
    this.ended = true;
  }
}

async function conMigracion(ejecutar: (directorio: string) => Promise<void>): Promise<void> {
  const directorio = await fs.mkdtemp(path.join(os.tmpdir(), "rsp07f-r7-migrator-"));
  try {
    await fs.writeFile(path.join(directorio, "000_prueba.sql"), "SELECT 42;\n");
    await ejecutar(directorio);
  } finally { await fs.rm(directorio, { recursive: true, force: true }); }
}

test("migracion normal hace unlock, release y permite pool.end", () => conMigracion(async (directorio) => {
  const pool = new PoolControlado(new ClienteControlado());
  const resultado = await ejecutarMigraciones(pool as never, { directorio, logger: () => undefined });
  await pool.end();
  assert.deepEqual(resultado.aplicadas, ["000_prueba.sql"]);
  assert.equal(pool.client.liberado, true);
  assert.equal(pool.client.argumentoRelease, undefined);
  assert.equal(pool.ended, true);
  assert.ok(pool.client.consultas.findIndex((sql) => sql.includes("pg_advisory_unlock")) < pool.client.consultas.indexOf("RELEASE"));
}));

test("error de migracion hace rollback, unlock y release conservando la causa", () => conMigracion(async (directorio) => {
  const principal = new Error("fallo SQL controlado");
  const pool = new PoolControlado(new ClienteControlado({ errorMigracion: principal }));
  await assert.rejects(
    () => ejecutarMigraciones(pool as never, { directorio, logger: () => undefined }),
    (error: unknown) => error instanceof Error && /Falló la migración 000_prueba.sql/.test(error.message) && error.cause === principal,
  );
  await pool.end();
  assert.ok(pool.client.consultas.includes("ROLLBACK"));
  assert.equal(pool.client.liberado, true);
  assert.equal(pool.client.argumentoRelease, undefined);
  assert.equal(pool.ended, true);
}));

test("unlock fallido libera y descarta el cliente, y pool.end no queda colgado", () => conMigracion(async (directorio) => {
  const unlock = Object.assign(new Error("conexion perdida"), { code: "ECONNRESET" });
  const pool = new PoolControlado(new ClienteControlado({ errorUnlock: unlock }));
  await assert.rejects(() => ejecutarMigraciones(pool as never, { directorio, logger: () => undefined }), (error) => error === unlock);
  const termino = await Promise.race([pool.end().then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 100))]);
  assert.equal(termino, true);
  assert.equal(pool.client.liberado, true);
  assert.equal(pool.client.argumentoRelease, unlock);
  assert.equal(pool.ended, true);
}));

test("error de migracion prevalece si unlock tambien falla y un segundo migrador puede continuar", () =>
  conMigracion(async (directorio) => {
    const principal = new Error("fallo SQL controlado");
    const unlock = Object.assign(new Error("conexion perdida"), { code: "ECONNRESET" });
    const mensajes: string[] = [];
    const fallido = new PoolControlado(new ClienteControlado({ errorMigracion: principal, errorUnlock: unlock }));
    await assert.rejects(
      () => ejecutarMigraciones(fallido as never, { directorio, logger: (mensaje) => mensajes.push(mensaje) }),
      (error: unknown) => error instanceof Error && /Falló la migración 000_prueba.sql/.test(error.message) && error.cause === principal,
    );
    const termino = await Promise.race([fallido.end().then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 100))]);
    assert.equal(termino, true);
    assert.equal(fallido.client.argumentoRelease, unlock);
    assert.deepEqual(mensajes, ["Falló la liberación del lock de migraciones después de un error principal."]);

    const recuperado = new PoolControlado(new ClienteControlado());
    await ejecutarMigraciones(recuperado as never, { directorio, logger: () => undefined });
    await recuperado.end();
    assert.equal(recuperado.ended, true);
  }));
