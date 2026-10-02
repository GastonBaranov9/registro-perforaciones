// PostgreSQL real y aislado: no lee .env, no usa Docker ni bases existentes.
// node --experimental-strip-types test/numeracion-perforacion-postgres.local.ts [directorio-bin]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import Fastify from "fastify";
import { ejecutarMigraciones, leerMigraciones } from "../src/db/migrator.ts";
import { crearPozoCompleto, actualizarPozoCompleto } from "../src/services/pozo-completo-service.ts";
import { asignarNumeroPendiente, configurarNumeracion, consultarNumero, obtenerNumeracion } from "../src/services/numeracion-perforacion-service.ts";
import { getReportePozo } from "../src/services/generar-informe-consultas.ts";
import type { PozoCompletoBody } from "../src/models/schemas.ts";
import { myPool } from "../src/db/pool.ts";
import numeracionRoutes from "../src/routes/numeracion-perforacion.ts";
import pozoRoutes from "../src/routes/pozos.ts";
import { T05SinPermiso } from "../src/models/errors.ts";

const bin = process.argv[2] ?? "C:/Program Files/PostgreSQL/18/bin";
const root = mkdtempSync(path.join(tmpdir(), "rsp10-numeracion-pg-"));
const data = path.join(root, "data");
const password = randomBytes(24).toString("hex");
const passwordFile = path.join(root, "password");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
env.PGPASSWORD = password;
const listener = createServer();
await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
const address = listener.address();
assert.ok(address && typeof address === "object");
const port = address.port;
await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
function pg(command: string, args: string[]) {
  return execFileSync(path.join(bin, command + (process.platform === "win32" ? ".exe" : "")), args, {
    encoding: "utf8", env, windowsHide: true, timeout: 60_000,
    stdio: command === "pg_ctl" ? "ignore" : ["pipe", "pipe", "pipe"],
  })?.trim() ?? "";
}
function connection(database: string) {
  return new Pool({ host: "127.0.0.1", port, user: "postgres", password, database, ssl: false, options: "", max: 8 });
}
const migrations = await leerMigraciones();
const through010 = path.join(root, "through010");
mkdirSync(through010);
for (const m of migrations.filter(m => m.version <= "010"))
  copyFileSync(new URL("../db/migrations/" + m.archivo, import.meta.url), path.join(through010, m.archivo));
const logger = () => {};
const seed = [
  "INSERT INTO usuario(id_usuario,nombre,email,password,cuenta_acceso) VALUES (1,'Admin','admin@example.test','no-login',TRUE),(2,'Perforador A','a@example.test','no-login',TRUE),(3,'Perforador B','b@example.test','no-login',TRUE),(4,'Propietario',NULL,NULL,FALSE)",
  "INSERT INTO usuario_rol SELECT 1,id_rol FROM rol WHERE nombre='administracion'",
  "INSERT INTO usuario_rol SELECT u.id,id_rol FROM rol CROSS JOIN (VALUES (2),(3)) u(id) WHERE nombre='perforador'",
  "INSERT INTO usuario_rol SELECT 4,id_rol FROM rol WHERE nombre='propietario'",
].join(";");
function body(numero?: number | null, perforador = 2): PozoCompletoBody {
  return {
    pozo: { id_propietario: 4, id_perforador: perforador, profundidad_final_m: 30, ...(numero === undefined ? {} : { numero_perforacion: numero }) },
    sitio_nuevo: { departamento: "Salto", localidad: "Ensayo", latitud: "-31.3", longitud: "-57.9" },
    intervalos_litologicos: [{ desde_m: 0, hasta_m: 5, material: "Sello sanitario", id_litologia: 30 }, { desde_m: 5, hasta_m: 30, material: "Basalto marrón", id_litologia: 1 }],
    intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [],
  };
}
const status = (code: number) => (error: unknown) => (error as { statusCode?: number })?.statusCode === code;
let started = false;
let adminPool: Pool | undefined;
try {
  writeFileSync(passwordFile, password);
  pg("initdb", ["-D", data, "-U", "postgres", "--auth=scram-sha-256", "--pwfile=" + passwordFile, "--encoding=UTF8", "--locale=C"]);
  started = true;
  pg("pg_ctl", ["-D", data, "-l", path.join(root, "postgres.log"), "-o", "-h 127.0.0.1 -p " + port, "-w", "-t", "30", "start"]);
  adminPool = connection("postgres");
  assert.equal(path.resolve((await adminPool.query("SHOW data_directory")).rows[0].data_directory).toLowerCase(), path.resolve(data).toLowerCase());
  console.log(pg("postgres", ["--version"]) + ": clúster temporal propio, sin piloto ni Docker.");
  for (const scenario of ["fresh", "pilot_equivalent"]) {
    await adminPool.query("CREATE DATABASE " + scenario);
    const pool = connection(scenario);
    try {
      let previo: unknown;
      if (scenario === "pilot_equivalent") {
        await ejecutarMigraciones(pool, { directorio: through010, logger });
        await pool.query(seed);
        await pool.query("INSERT INTO sitio(departamento) VALUES ('Salto'); INSERT INTO pozo(id_propietario,id_perforador,id_sitio) VALUES (4,2,1); INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia) VALUES (1,0,5,'Basalto marrón',1)");
        previo = (await pool.query("SELECT row_to_json(p) AS pozo FROM pozo p")).rows[0].pozo;
      }
      const resultado = await ejecutarMigraciones(pool, { logger });
      assert.equal(resultado.pendientes, 0);
      assert.ok(resultado.aplicadas.includes("011_numero_perforacion.sql"));
      assert.deepEqual((await ejecutarMigraciones(pool, { logger })).aplicadas, []);
      assert.equal((await pool.query("SELECT contype FROM pg_constraint WHERE conrelid='pozo'::regclass AND conname='pozo_numero_perforacion_uq'")).rows[0].contype, "u");
      assert.equal((await pool.query("SELECT contype FROM pg_constraint WHERE conrelid='pozo'::regclass AND conname='pozo_numero_perforacion_positivo'")).rows[0].contype, "c");
      if (previo) {
        const after = (await pool.query("SELECT row_to_json(p) AS pozo FROM pozo p")).rows[0].pozo;
        assert.deepEqual(after, { ...previo, numero_perforacion: null, propietario_provisional: null });
        assert.equal((await pool.query("SELECT id_pozo FROM intervalo_litologico")).rows[0].id_pozo, "1");
      } else await pool.query(seed);
      assert.deepEqual(await obtenerNumeracion(1, pool), { proximo: null, minimo: 1, agotado: false });
      await assert.rejects(crearPozoCompleto(2, body(), root, pool), status(409));
      await assert.rejects(configurarNumeracion(2, 2047, null, pool), status(403));
      await assert.rejects(crearPozoCompleto(2, body(1850), root, pool), status(403));
      for (const invalid of [0, -1, 1.5, NaN, Infinity, 2147483648, "2047", true]) {
        await assert.rejects(configurarNumeracion(1, invalid as number, null, pool), status(400));
        await assert.rejects(crearPozoCompleto(1, body(invalid as number), root, pool), status(400));
      }
      await configurarNumeracion(1, 2047, null, pool);
      // Hold the real counter lock so both creates are pending together.
      const lock = await pool.connect();
      await lock.query("BEGIN");
      await lock.query("SELECT 1 FROM numeracion_perforacion WHERE singleton FOR UPDATE");
      const concurrentes = Promise.all([crearPozoCompleto(2, body(), root, pool), crearPozoCompleto(3, body(undefined, 3), root, pool)]);
      try {
        let esperando = 0;
        for (let intento = 0; intento < 100 && esperando < 2; intento++) {
          esperando = Number((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%INSERT INTO public.pozo%'")).rows[0].count);
          if (esperando < 2) await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(esperando, 2, "Dos conexiones reales deben estar esperando simultáneamente el contador");
      } finally { await lock.query("COMMIT"); lock.release(); }
      const primeros = await concurrentes;
      assert.deepEqual(primeros.map(p => p.pozo.numero_perforacion).sort(), [2047, 2048]);
      assert.notEqual(primeros[0].pozo.id_pozo, primeros[1].pozo.id_pozo);
      assert.equal((await crearPozoCompleto(1, body(1850), root, pool)).pozo.numero_perforacion, 1850);
      assert.equal((await crearPozoCompleto(2, body(null), root, pool)).pozo.numero_perforacion, 2049);
      assert.equal((await crearPozoCompleto(1, body(1990), root, pool)).pozo.numero_perforacion, 1990);
      assert.equal((await crearPozoCompleto(2, body(), root, pool)).pozo.numero_perforacion, 2050);
      await assert.rejects(crearPozoCompleto(1, body(1850), root, pool), status(409));
      const beforeRollback = await obtenerNumeracion(1, pool);
      const invalidChild = body(); invalidChild.intervalos_litologicos[0].id_litologia = 999999;
      await assert.rejects(crearPozoCompleto(2, invalidChild, root, pool), status(400));
      assert.deepEqual(await obtenerNumeracion(1, pool), beforeRollback);
      const fallido = body(5000); fallido.intervalos_litologicos[0].id_litologia = 999999;
      await assert.rejects(crearPozoCompleto(1, fallido, root, pool), status(400));
      assert.deepEqual(await consultarNumero(1, 5000, pool), { utilizado: false });
      assert.deepEqual(await obtenerNumeracion(1, pool), beforeRollback);
      const alto = await crearPozoCompleto(1, body(3000), root, pool);
      assert.equal((await obtenerNumeracion(1, pool)).proximo, 3001);
      await assert.rejects(pool.query("UPDATE pozo SET numero_perforacion=NULL WHERE id_pozo=$1", [alto.pozo.id_pozo]), { code: "P1102" });
      await assert.rejects(pool.query("UPDATE pozo SET numero_perforacion=3002 WHERE id_pozo=$1", [alto.pozo.id_pozo]), { code: "P1102" });
      await pool.query("DELETE FROM pozo WHERE id_pozo=$1", [alto.pozo.id_pozo]);
      assert.deepEqual(await consultarNumero(1, 3000, pool), { utilizado: true });
      await assert.rejects(crearPozoCompleto(1, body(3000), root, pool), status(409));
      await assert.rejects(configurarNumeracion(1, 2000, 3001, pool), status(409));
      await assert.rejects(configurarNumeracion(1, 4000, 2051, pool), status(409));
      // Manual and auto competing for the next number: either order is valid.
      const race = await Promise.allSettled([crearPozoCompleto(1, body(3001), root, pool), crearPozoCompleto(2, body(), root, pool)]);
      assert.equal(race[1].status, "fulfilled");
      const numeros = race.filter(r => r.status === "fulfilled").map(r => r.value.pozo.numero_perforacion);
      assert.equal(new Set(numeros).size, numeros.length);
      if (race[0].status === "rejected") assert.ok(status(409)(race[0].reason));
      const sameHistory = await Promise.allSettled([crearPozoCompleto(1, body(1700), root, pool), crearPozoCompleto(1, body(1700), root, pool)]);
      assert.equal(sameHistory.filter(r => r.status === "fulfilled").length, 1);
      assert.ok(sameHistory.some(r => r.status === "rejected" && status(409)(r.reason)));
      const reporte = await getReportePozo(primeros[0].pozo.id_pozo, pool);
      assert.equal(reporte?.numero_perforacion, primeros[0].pozo.numero_perforacion);
      assert.deepEqual(reporte?.litologia.map(l => [l.desde_m, l.hasta_m, l.id_litologia]), [[0, 5, 30], [5, 30, 1]]);
      if (previo) {
        await assert.rejects(asignarNumeroPendiente(2, 1, 1800, pool), status(403));
        const before = await obtenerNumeracion(1, pool);
        await asignarNumeroPendiente(1, 1, 1800, pool);
        assert.deepEqual(await obtenerNumeracion(1, pool), before);
        await assert.rejects(asignarNumeroPendiente(1, 1, 1801, pool), status(409));
        assert.equal((await pool.query("SELECT count(*) FROM intervalo_litologico WHERE id_pozo=1")).rows[0].count, "1");
      }
      // La APK anterior puede devolver el campo agregado al editar: sólo se acepta el mismo valor.
      const editar = body(primeros[0].pozo.numero_perforacion);
      const editado = await actualizarPozoCompleto(primeros[0].pozo.id_pozo, {
        pozo: { ...editar.pozo, id_sitio: primeros[0].pozo.id_sitio },
        intervalos_litologicos: editar.intervalos_litologicos,
        intervalos_diametro: [], intervalos_filtro: [], niveles_aporte: [], foto_accion: "conservar",
      }, root, pool);
      assert.equal(editado.pozo.numero_perforacion, primeros[0].pozo.numero_perforacion);
      // Real HTTP route schemas + services against this isolated database.
      const oldQuery = myPool.query, oldConnect = myPool.connect;
      myPool.query = pool.query.bind(pool);
      myPool.connect = pool.connect.bind(pool);
      const app = Fastify();
      app.decorate("authenticate", async req => { req.user = { sub: Number(req.headers["x-test-user"] ?? 2) } as typeof req.user; });
      app.decorate("userIsAdmin", async req => { if (req.user.sub !== 1) throw new T05SinPermiso(); });
      for (const name of ["userIsAdminOrPerforador", "pozoIsFromUser", "userIsPropietarioOrPerforadorOrAdmin"]) app.decorate(name, async () => {});
      app.decorate("notifyClient", () => {});
      try {
        await app.register(numeracionRoutes); await app.register(pozoRoutes);
        assert.equal((await app.inject({ method: "PUT", url: "/pozos/numeracion", payload: { proximo: 8000, esperado: null } })).statusCode, 403);
        for (const numero of [0, -1, 1.5, 2147483648, true, false, "", "2047"]) {
          assert.equal((await app.inject({ method: "POST", url: "/usuarios/4/pozos/completo", headers: { "x-test-user": "1" }, payload: body(numero as number) })).statusCode, 400, "Número inválido: " + numero);
        }
        const denied = await app.inject({ method: "POST", url: "/usuarios/4/pozos/completo", payload: body(1000) });
        assert.equal(denied.statusCode, 403, denied.body);
        const duplicate = await app.inject({ method: "POST", url: "/usuarios/4/pozos/completo", headers: { "x-test-user": "1" }, payload: body(1850) });
        assert.equal(duplicate.statusCode, 409, duplicate.body);
        const provisional = body();
        provisional.pozo.id_propietario = null;
        provisional.pozo.propietario_provisional = 'Cliente en campo';
        const created = await app.inject({ method: "POST", url: "/usuarios/4/pozos/completo", payload: provisional });
        assert.equal(created.statusCode, 201, created.body);
        assert.ok(created.json().pozo.numero_perforacion > 3001);
        const list = await app.inject({ method: "GET", url: "/usuarios/2/pozos" });
        assert.equal(list.statusCode, 200, list.body);
        assert.ok(list.json().some((p: { numero_perforacion?: number }) => p.numero_perforacion === primeros[0].pozo.numero_perforacion));
        const response = await app.inject({ method: "GET", url: "/usuarios/2/pozos/" + created.json().pozo.id_pozo });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().numero_perforacion, created.json().pozo.numero_perforacion);
      } finally { await app.close(); myPool.query = oldQuery; myPool.connect = oldConnect; }
      const { pozo: paraEditar, ...resto } = body(999);
      await assert.rejects(actualizarPozoCompleto(primeros[0].pozo.id_pozo, {
        ...resto, pozo: { ...paraEditar, id_sitio: primeros[0].pozo.id_sitio }, foto_accion: "conservar",
      }, root, pool), status(400));
      const actual = await obtenerNumeracion(1, pool);
      await configurarNumeracion(1, 2147483647, actual.proximo, pool);
      assert.equal((await crearPozoCompleto(2, body(), root, pool)).pozo.numero_perforacion, 2147483647);
      assert.equal((await obtenerNumeracion(1, pool)).agotado, true);
      await assert.rejects(crearPozoCompleto(2, body(), root, pool), status(409));
      console.log("PASS " + scenario + ": migración, piloto sin renumerar, concurrencia, históricos, rollback, reservas, permisos HTTP, inválidos, listado/detalle/reporte y agotamiento.");
    } finally { await pool.end(); }
  }
} finally {
  await adminPool?.end();
  if (started) pg("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "30", "stop"]);
  const resolvedRoot = path.resolve(root);
  assert.equal(path.dirname(resolvedRoot), path.resolve(tmpdir()));
  assert.ok(path.basename(resolvedRoot).startsWith("rsp10-numeracion-pg-"));
  rmSync(resolvedRoot, { recursive: true, force: true });
}
