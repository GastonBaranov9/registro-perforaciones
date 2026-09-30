// Explicit isolated integration check. Container identity is fixed and inspected;
// no environment database settings, ports, passwords or pilot resources are used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
const container = 'rsp10-catalog-audit';
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(info.HostConfig.NetworkMode, 'none');
assert.ok('/var/lib/postgresql/data' in info.HostConfig.Tmpfs);
assert.equal(info.Mounts.some((m: { Type: string }) => m.Type === 'volume' || m.Type === 'bind'), false);
const database = `rsp10_check_${Date.now()}`;
execFileSync('docker', ['exec', container, 'createdb', '-U', 'postgres', database]);
function sql(input: string, targetDatabase = database): string {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', targetDatabase, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
const dir = new URL('../db/migrations/', import.meta.url);
const migration = readFileSync(new URL('009_sello_sanitario.sql', dir), 'utf8');
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
assert.match(sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='catalogo_litologia'::regclass AND conname='catalogo_litologia_patron_check'"), /concrete/);
assert.equal(sql("SELECT count(*) FROM catalogo_litologia WHERE codigo='sello_sanitario' AND patron='concrete' AND color='#999999' AND activo"), '1');
assert.equal(sql('SELECT count(*) FROM catalogo_litologia'), '30');
assert.equal(sql("SELECT json_agg(c ORDER BY id_litologia)::text FROM catalogo_litologia c WHERE codigo <> 'sello_sanitario'"), before);
const after = sql('SELECT json_agg(c ORDER BY id_litologia)::text FROM catalogo_litologia c;');
sql(`BEGIN; ${migration} COMMIT;`);
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
    run(`BEGIN; ${migration} COMMIT;`);
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
console.log('PASS: 000-009, UNIQUE normalizado, concrete, 30 materiales, históricos intactos, profundidad editable, booleano independiente, idempotencia, colisiones simples/dobles y rollback transaccional.');
