// Native temporary PostgreSQL cluster: no containers, .env or existing databases.
// Run from api: node --experimental-strip-types test/sello-sanitario-postgres.local.ts
// Optional argv[2]: PostgreSQL bin directory (defaults to the local Windows install).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { ejecutarMigraciones, leerMigraciones, verificarEsquemaBaseline } from '../src/db/migrator.ts';

const bin = process.argv[2] ?? 'C:/Program Files/PostgreSQL/18/bin';
const root = mkdtempSync(path.join(tmpdir(), 'rsp10-forward-only-'));
const data = path.join(root, 'data');
const password = randomBytes(24).toString('hex');
const passwordFile = path.join(root, 'password');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
env.PGPASSWORD = password;
const listener = createServer();
await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
const address = listener.address();
assert.ok(address && typeof address === 'object');
const port = address.port;
await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
function pg(command: string, args: string[], input?: string): string {
  // pg_ctl's background server must not inherit pipes that keep execFileSync open.
  const output = execFileSync(path.join(bin, command + (process.platform === 'win32' ? '.exe' : '')), args,
    { input, encoding: 'utf8', env, windowsHide: true, timeout: 60_000,
      stdio: command === 'pg_ctl' ? 'ignore' : ['pipe', 'pipe', 'pipe'] });
  return output?.trim() ?? '';
}
const database = 'rsp10_catalog';
function sql(input: string, targetDatabase = database): string {
  return pg('psql', ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', targetDatabase, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At'], input);
}
const dir = new URL('../db/migrations/', import.meta.url);
const migration = readFileSync(new URL('009_sello_sanitario.sql', dir), 'utf8');
const correction = readFileSync(new URL('010_sello_sanitario_no_inicial.sql', dir), 'utf8');
let started = false;
try {
writeFileSync(passwordFile, password);
pg('initdb', ['-D', data, '-U', 'postgres', '--auth=scram-sha-256', `--pwfile=${passwordFile}`, '--encoding=UTF8', '--locale=C']);
started = true;
pg('pg_ctl', ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', '-t', '30', 'start']);
console.log(pg('postgres', ['--version']));
const actualData = sql('SHOW data_directory', 'postgres');
assert.equal(path.resolve(actualData).toLowerCase(), path.resolve(data).toLowerCase());
console.log('PASS aislamiento: clúster temporal propio, loopback, credenciales aleatorias; sin Docker ni configuración del piloto.');

// Esta regresión prueba deliberadamente 000..010; la numeración 011 tiene su runner propio.
const migrations = (await leerMigraciones()).filter(m => m.version <= "010");
const through010 = path.join(root, "through010");
mkdirSync(through010);
const through009 = path.join(root, 'through009');
const failing011 = path.join(root, 'failing011');
mkdirSync(through009);
mkdirSync(failing011);
for (const m of migrations) {
  copyFileSync(new URL(m.archivo, dir), path.join(through010, m.archivo));
  if (m.version <= '009') copyFileSync(new URL(m.archivo, dir), path.join(through009, m.archivo));
  copyFileSync(new URL(m.archivo, dir), path.join(failing011, m.archivo));
}
writeFileSync(path.join(failing011, '011_control_failure.sql'), "UPDATE catalogo_litologia SET es_inicial=TRUE WHERE codigo='sello_sanitario';\nCREATE TABLE rsp10_partial(id integer);\nSELECT funcion_inexistente_rsp10();\n");
const catalogSnapshot = "SELECT json_agg(c ORDER BY id_litologia)::text FROM catalogo_litologia c";
const ledgerSnapshot = 'SELECT json_agg(m ORDER BY version)::text FROM schema_migrations m';
const seedHistory = `INSERT INTO usuario(nombre,cuenta_acceso) VALUES ('Persona de prueba',false);
INSERT INTO sitio(departamento) VALUES ('Salto');
INSERT INTO pozo(id_propietario,id_perforador,id_sitio,profundidad_final_m,sello_sanitario) VALUES (1,1,1,30,false);
INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia) VALUES (1,3.5,30,'Basalto histórico',1);`;
for (const scenario of ['fresh', 'pilot_equivalent'] as const) {
  sql(`CREATE DATABASE ${scenario}`, 'postgres');
  const run = (statement: string) => sql(statement, scenario);
  const pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: scenario, ssl: false, options: '', max: 1 });
  const logs: string[] = [];
  const logger = (message: string) => logs.push(message);
  try {
    let history: string | undefined;
    let intervals: string | undefined;
    let originalSeal: Record<string, unknown> | undefined;
    let prefix: string | undefined;
    if (scenario === 'pilot_equivalent') {
      await assert.rejects(ejecutarMigraciones(pool, { directorio: through009, logger }),
        /El esquema final no pasó la verificación: el conjunto de litologías iniciales no coincide/);
      assert.equal(run("SELECT count(*)=10 AND max(version)='009' FROM schema_migrations"), 't');
      assert.equal(run('SELECT count(*) FROM catalogo_litologia WHERE es_inicial'), '30');
      assert.equal(run("SELECT es_inicial FROM catalogo_litologia WHERE codigo='sello_sanitario'"), 't');
      run(seedHistory);
      history = run(catalogSnapshot + " WHERE codigo <> 'sello_sanitario'");
      intervals = run('SELECT json_agg(i)::text FROM intervalo_litologico i');
      originalSeal = JSON.parse(run("SELECT row_to_json(c)::text FROM catalogo_litologia c WHERE codigo='sello_sanitario'"));
      prefix = run(ledgerSnapshot);
    }
    const result = await ejecutarMigraciones(pool, { directorio: through010, logger });
    assert.deepEqual(result.aplicadas, scenario === 'fresh' ? migrations.map(m => m.archivo) : ['010_sello_sanitario_no_inicial.sql']);
    assert.equal(result.pendientes, 0);
    assert.equal(run("SELECT count(*)=11 AND max(version)='010' FROM schema_migrations"), 't');
    assert.equal(run('SELECT count(*) FROM catalogo_litologia'), '30');
    assert.equal(run('SELECT count(*) FROM catalogo_litologia WHERE es_inicial'), '29');
    assert.equal(run("SELECT count(*) FROM catalogo_litologia WHERE codigo='sello_sanitario' AND nombre='Sello sanitario' AND activo AND NOT es_inicial AND patron='concrete' AND color='#999999' AND orden=30"), '1');
    const client = await pool.connect();
    try { assert.deepEqual(await verificarEsquemaBaseline(client), []); } finally { client.release(); }
    if (scenario === 'pilot_equivalent') {
      assert.equal(run(catalogSnapshot + " WHERE codigo <> 'sello_sanitario'"), history);
      assert.equal(run('SELECT json_agg(i)::text FROM intervalo_litologico i'), intervals);
      assert.equal(run(ledgerSnapshot + " WHERE version <= '009'"), prefix);
      assert.deepEqual(JSON.parse(run("SELECT row_to_json(c)::text FROM catalogo_litologia c WHERE codigo='sello_sanitario'")), { ...originalSeal, es_inicial: false });
    } else run(seedHistory);
    // The active catalog entry can still be selected and referenced normally.
    run(`INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia)
      SELECT 1,0,3.5,nombre,id_litologia FROM catalogo_litologia WHERE codigo='sello_sanitario' AND activo`);
    assert.equal(run('SELECT count(*) FROM intervalo_litologico'), '2');
    assert.equal(run('SELECT sello_sanitario FROM pozo WHERE id_pozo=1'), 'f');
    const catalog = run(catalogSnapshot);
    const ledger = run(ledgerSnapshot);
    const rerun = await ejecutarMigraciones(pool, { directorio: through010, logger });
    assert.deepEqual(rerun.aplicadas, []);
    assert.match(logs.at(-1)!, /no hay cambios pendientes/);
    // SQL idempotence is independent of the ledger's no-op behavior.
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      assert.equal((await connection.query(correction)).rowCount, 0);
      await connection.query('COMMIT');
    } finally { connection.release(); }
    await assert.rejects(ejecutarMigraciones(pool, { directorio: failing011, logger }), /Falló la migración 011_control_failure.sql/);
    assert.equal(run("SELECT to_regclass('public.rsp10_partial') IS NULL"), 't');
    assert.equal(run(catalogSnapshot), catalog);
    assert.equal(run(ledgerSnapshot), ledger);
    console.log(`PASS ${scenario}: ${result.aplicadas.length} migraciones aplicadas; ledger 000..010; catálogo=30; iniciales=29; Sello sanitario activo/no inicial/concrete/#999999; verificación final PASS; rerun: ${logs.find(m => m.includes('no hay cambios pendientes'))}; idempotencia y rollback 011 PASS.`);
  } finally { await pool.end(); }
}

sql(`CREATE DATABASE ${database}`, 'postgres');
for (const name of readdirSync(dir).filter(n => /^00[0-8]_.*\.sql$/.test(n)).sort()) sql(readFileSync(new URL(name, dir), 'utf8'));
sql(`INSERT INTO usuario(nombre,cuenta_acceso) VALUES ('Persona de prueba',false);
INSERT INTO sitio(departamento) VALUES ('Salto');
INSERT INTO pozo(id_propietario,id_perforador,id_sitio,profundidad_final_m,sello_sanitario) VALUES (1,1,1,30,false);
INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia) VALUES (1,3.5,30,'Basalto histórico',1);`);
const intervalos = sql('SELECT json_agg(i)::text FROM intervalo_litologico i');
const before = sql('SELECT json_agg(c ORDER BY id_litologia)::text FROM catalogo_litologia c;');
assert.equal(sql("SELECT contype FROM pg_constraint WHERE conrelid='catalogo_litologia'::regclass AND conname='catalogo_litologia_nombre_normalizado_uq'"), 'u');
const baseline = `${database}_baseline`;
sql(`CREATE DATABASE ${baseline} TEMPLATE ${database}`, 'postgres');
sql(`BEGIN; ${migration} COMMIT;`);
assert.equal(sql("SELECT es_inicial FROM catalogo_litologia WHERE codigo='sello_sanitario'"), 't');
sql(`BEGIN; ${correction} COMMIT;`);
assert.match(sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='catalogo_litologia'::regclass AND conname='catalogo_litologia_patron_check'"), /concrete/);
assert.equal(sql("SELECT count(*) FROM catalogo_litologia WHERE codigo='sello_sanitario' AND patron='concrete' AND color='#999999' AND activo AND NOT es_inicial"), '1');
assert.equal(sql('SELECT count(*) FROM catalogo_litologia'), '30');
assert.equal(sql('SELECT count(*) FROM catalogo_litologia WHERE es_inicial'), '29');
assert.equal(sql("SELECT json_agg(c ORDER BY id_litologia)::text FROM catalogo_litologia c WHERE codigo <> 'sello_sanitario'"), before);
const after = sql('SELECT json_agg(c ORDER BY id_litologia)::text FROM catalogo_litologia c;');
sql(`BEGIN; ${migration} COMMIT;`);
sql(`BEGIN; ${correction} COMMIT;`);
assert.equal(sql('SELECT json_agg(c ORDER BY id_litologia)::text FROM catalogo_litologia c;'), after);
assert.equal(sql('SELECT json_agg(i)::text FROM intervalo_litologico i'), intervalos);
sql(`INSERT INTO intervalo_litologico(id_pozo,desde_m,hasta_m,material,id_litologia)
SELECT 1,0,3.5,nombre,id_litologia FROM catalogo_litologia WHERE codigo='sello_sanitario'`);
assert.equal(sql('SELECT sello_sanitario FROM pozo WHERE id_pozo=1'), 'f');
assert.equal(sql('SELECT count(*) FROM intervalo_litologico'), '2');
assert.throws(() => sql("UPDATE catalogo_litologia SET patron='invalido' WHERE codigo='sello_sanitario'"));
assert.throws(() => sql("UPDATE catalogo_litologia SET color='gris' WHERE codigo='sello_sanitario'"));

// Each conflict scenario starts at 008 with the same historical intervals.
for (const scenario of ['codigo', 'nombre', 'normalizado', 'doble'] as const) {
  const target = `${database}_${scenario}`;
  sql(`CREATE DATABASE ${target} TEMPLATE ${baseline}`, 'postgres');
  const run = (statement: string) => sql(statement, target);
  if (scenario === 'codigo' || scenario === 'doble') {
    run("INSERT INTO catalogo_litologia(codigo,nombre,familia,color,patron,orden,es_inicial,activo) VALUES ('sello_sanitario','Material configurado por administración','otro','#123456','granite',77,false,false)");
  }
  if (scenario !== 'codigo') {
    const nombre = scenario === 'normalizado' ? 'SÉLLO   SANITARIO' : 'Sello sanitario';
    run(`INSERT INTO catalogo_litologia(codigo,nombre,familia,color,patron,orden,es_inicial) VALUES ('sello_local','${nombre}','otro','#888888','granite',78,false)`);
  }
  const snapshot = run('SELECT json_agg(c ORDER BY id_litologia)::text FROM catalogo_litologia c');
  const oldConstraint = run("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='catalogo_litologia'::regclass AND conname='catalogo_litologia_patron_check'");
  if (scenario === 'codigo') {
    run(`BEGIN; ${migration} COMMIT;`);
    run(`BEGIN; ${correction} COMMIT;`);
    run(`BEGIN; ${migration} COMMIT;`);
    run(`BEGIN; ${correction} COMMIT;`);
  } else {
    assert.throws(() => run(`BEGIN; ${migration} COMMIT;`), (error: unknown) =>
      typeof error === 'object' && error !== null && 'stderr' in error && /23505/.test(String(error.stderr)),
      `${scenario}: la colisión debe impedir toda la migración`);
    assert.equal(run("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='catalogo_litologia'::regclass AND conname='catalogo_litologia_patron_check'"), oldConstraint, 'El DDL debe revertirse junto con el INSERT');
  }
  assert.equal(run('SELECT json_agg(c ORDER BY id_litologia)::text FROM catalogo_litologia c'), snapshot);
  assert.equal(run('SELECT json_agg(i)::text FROM intervalo_litologico i'), intervalos);
  console.log(`PASS conflicto ${scenario}: catálogo e intervalos conservados`);
}
console.log('PASS: 000..010, UNIQUE normalizado, concrete, 30 materiales, 29 iniciales históricos intactos, profundidad editable, booleano independiente, idempotencia, colisiones simples/dobles y rollback transaccional.');
} finally {
  // Stop only the cluster we created; preserve files if shutdown fails.
  if (started) pg('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '30', 'stop']);
  const resolvedRoot = path.resolve(root);
  assert.equal(path.dirname(resolvedRoot), path.resolve(tmpdir()));
  assert.ok(path.basename(resolvedRoot).startsWith('rsp10-forward-only-'));
  rmSync(resolvedRoot, { recursive: true, force: true });
}
