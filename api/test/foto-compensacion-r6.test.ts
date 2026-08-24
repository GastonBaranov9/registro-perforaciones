import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  eliminarFotoPersistida,
  eliminarPozoPersistido,
  reemplazarFotoPersistida,
} from "../src/services/foto-pozo-service.ts";
import { compensarFalloTransaccionalFotos } from "../src/services/foto-archivo-service.ts";
import { reconciliarFotos } from "../src/services/fotos-reconcile-service.ts";

function poolConFallo(idPozo: number, mutacion: "foto" | "pozo", fallarRollback: boolean) {
  const principal = new Error("fallo primario controlado");
  const consultas: string[] = [];
  const client = {
    async query(sql: string) {
      consultas.push(sql.trim());
      if (sql.includes("FOR UPDATE")) return { rows: [{ id_pozo: idPozo, foto_url: "/foto" }] };
      if (sql === "ROLLBACK" && fallarRollback)
        throw Object.assign(new Error("conexion perdida"), { code: "ECONNRESET" });
      if (mutacion === "foto" && sql.includes("SET foto_url = NULL")) throw principal;
      if (mutacion === "pozo" && sql.includes("DELETE FROM public.pozo")) throw principal;
      return { rows: [{ id_pozo: idPozo }] };
    },
    release() { consultas.push("RELEASE"); },
  };
  return { principal, consultas, pool: { async connect() { return client; } } };
}

async function temporal(nombre: string, ejecutar: (directorio: string) => Promise<void>): Promise<void> {
  const directorio = await fs.mkdtemp(path.join(os.tmpdir(), nombre));
  try { await ejecutar(directorio); }
  finally { await fs.rm(directorio, { recursive: true, force: true }); }
}

test("rollback DB fallido no impide intentar restaurar filesystem", async () => {
  let restaurada = false;
  const avisos: Array<Record<string, unknown>> = [];
  const resultado = await compensarFalloTransaccionalFotos({
    idPozo: 70,
    operacion: "fixture",
    rollback: async () => { throw Object.assign(new Error("caida"), { code: "57P01" }); },
    restaurar: async () => { restaurada = true; },
    logger: { warn(datos) { avisos.push(datos); } },
  });
  assert.equal(restaurada, true);
  assert.ok(resultado.errorRollback);
  assert.equal(resultado.errorFilesystem, undefined);
  assert.deepEqual(avisos, [{ id_pozo: 70, operacion: "fixture", etapa: "rollback_db", codigo: "57P01" }]);
});

test("eliminar foto restaura el archivo aunque UPDATE y ROLLBACK fallen", () =>
  temporal("rsp07f-r6-foto-", async (directorio) => {
    const archivo = path.join(directorio, "pozo-71.jpg");
    await fs.writeFile(archivo, "original");
    const falso = poolConFallo(71, "foto", true);
    const avisos: Array<Record<string, unknown>> = [];
    await assert.rejects(
      () => eliminarFotoPersistida(71, directorio, falso.pool as never, { logger: { warn(datos) { avisos.push(datos); } } }),
      (error) => error === falso.principal,
    );
    assert.equal(await fs.readFile(archivo, "utf8"), "original");
    assert.deepEqual(await fs.readdir(path.join(directorio, ".trash")), []);
    assert.ok(falso.consultas.includes("ROLLBACK"));
    assert.deepEqual(avisos, [{ id_pozo: 71, operacion: "eliminar_foto", etapa: "rollback_db", codigo: "ECONNRESET" }]);
  }));

test("eliminar pozo compensa todas sus fotos sin tocar otro pozo aunque falle ROLLBACK", () =>
  temporal("rsp07f-r6-pozo-", async (directorio) => {
    await fs.writeFile(path.join(directorio, "pozo-72.jpg"), "a");
    await fs.writeFile(path.join(directorio, "pozo-72.png"), "b");
    await fs.writeFile(path.join(directorio, "pozo-73.jpg"), "ajena");
    const falso = poolConFallo(72, "pozo", true);
    await assert.rejects(() => eliminarPozoPersistido(72, directorio, falso.pool as never), (error) => error === falso.principal);
    assert.equal(await fs.readFile(path.join(directorio, "pozo-72.jpg"), "utf8"), "a");
    assert.equal(await fs.readFile(path.join(directorio, "pozo-72.png"), "utf8"), "b");
    assert.equal(await fs.readFile(path.join(directorio, "pozo-73.jpg"), "utf8"), "ajena");
    assert.deepEqual(await fs.readdir(path.join(directorio, ".trash")), []);
  }));

test("fallo de restauracion devuelve error controlado y deja trash reconciliable", () =>
  temporal("rsp07f-r6-restore-", async (directorio) => {
    await fs.writeFile(path.join(directorio, "pozo-74.jpg"), "original");
    const falso = poolConFallo(74, "foto", false);
    const avisos: Array<Record<string, unknown>> = [];
    await assert.rejects(
      () => eliminarFotoPersistida(74, directorio, falso.pool as never, {
        logger: { warn(datos) { avisos.push(datos); } },
        restaurarCompensacion: async () => { throw Object.assign(new Error("disco"), { code: "EIO" }); },
      }),
      (error: unknown) => (error as { code?: string }).code === "ERR1_T05",
    );
    const reporte = await reconciliarFotos(directorio, [{ id_pozo: 74, foto_url: "/foto" }]);
    assert.equal(reporte.referencia_sin_archivo, 1);
    assert.equal(reporte.trash_total, 1);
    assert.deepEqual(avisos, [{ id_pozo: 74, operacion: "eliminar_foto", etapa: "filesystem_restore", codigo: "EIO" }]);
  }));

test("COMMIT confirmado purga sin ejecutar restauracion compensatoria", () =>
  temporal("rsp07f-r6-commit-", async (directorio) => {
    await fs.writeFile(path.join(directorio, "pozo-75.jpg"), "original");
    let restauraciones = 0;
    const pool = poolConFallo(75, "pozo", false).pool;
    const resultado = await eliminarFotoPersistida(75, directorio, pool as never, {
      restaurarCompensacion: async () => { restauraciones += 1; },
    });
    assert.deepEqual(resultado, { archivoExistia: true });
    assert.equal(restauraciones, 0);
    assert.equal(await fs.stat(path.join(directorio, "pozo-75.jpg")).then(() => true, () => false), false);
    assert.deepEqual(await fs.readdir(path.join(directorio, ".trash")), []);
  }));

test("reemplazar foto restaura la anterior aunque falle el rollback exterior", () =>
  temporal("rsp07f-r6-reemplazo-", async (directorio) => {
    const anterior = path.join(directorio, "pozo-76.jpg");
    await fs.writeFile(anterior, "anterior");
    const falso = poolConFallo(76, "pozo", true);
    await assert.rejects(
      () => reemplazarFotoPersistida(
        76,
        directorio,
        { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), extension: "png" },
        "/foto",
        async () => { throw falso.principal; },
        falso.pool as never,
      ),
      (error) => error === falso.principal,
    );
    assert.equal(await fs.readFile(anterior, "utf8"), "anterior");
    assert.equal(await fs.stat(path.join(directorio, "pozo-76.png")).then(() => true, () => false), false);
    assert.deepEqual(await fs.readdir(path.join(directorio, ".trash")), []);
  }));
