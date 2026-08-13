import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("Compose ofrece migrate/bootstrap/backup/restore como one-shots sin init SQL", async () => {
  const compose = await fs.readFile(path.join(repo, "docker-compose.production.yaml"), "utf8");
  assert.doesNotMatch(compose, /docker-entrypoint-initdb\.d/);
  for (const servicio of ["migrate", "bootstrap-admin", "backup", "restore"])
    assert.match(compose, new RegExp(`^  ${servicio}:`, "m"));
  assert.match(compose, /profiles: \["ops"\]/);
  assert.match(compose, /restart: "no"/);
  assert.match(compose, /BACKUP_DIR:\?Falta BACKUP_DIR/);
  assert.doesNotMatch(compose, /ADMIN_PASSWORD:/);
});

test("backup genera dump custom, archivo de fotos, manifest y checksums", async () => {
  const backup = await fs.readFile(path.join(repo, "ops", "backup.sh"), "utf8");
  assert.match(backup, /pg_dump --format=custom/);
  assert.match(backup, /tar -C \/data -czf/);
  assert.match(backup, /DATABASE_SHA256/);
  assert.match(backup, /PHOTOS_SHA256/);
  assert.match(backup, /MIGRATIONS=/);
  assert.match(backup, /mv "\$temporal" "\$final"/);
  assert.doesNotMatch(backup, /FASTIFY_SECRET|MAP_STATIC_API_KEY|ADMIN_PASSWORD/);
});

test("restore verifica antes de mutar y exige target vacío más confirmación exacta", async () => {
  const restore = await fs.readFile(path.join(repo, "ops", "restore.sh"), "utf8");
  const checksumAt = restore.indexOf("Checksum inválido para PostgreSQL");
  const emptyAt = restore.indexOf("Restore rechazado: la base destino no está vacía");
  const pgRestoreAt = restore.indexOf("pg_restore --exit-on-error --single-transaction");
  assert.ok(checksumAt > 0 && emptyAt > checksumAt && pgRestoreAt > emptyAt);
  assert.match(restore, /RESTORE_EMPTY_TARGET/);
  assert.match(restore, /chown -R 1000:1000 \/data\/fotos/);
});

test("retención es dry-run por defecto y solo reconoce bundles propios", async () => {
  const prune = await fs.readFile(path.join(repo, "ops", "prune-backups.ps1"), "utf8");
  assert.match(prune, /DRY-RUN PRUNE/);
  assert.match(prune, /rsp-backup-\\d\{8\}T\\d\{6\}Z/);
  assert.match(prune, /\$daily\.Count -lt 14/);
  assert.match(prune, /\$weekly\.Count -lt 8/);
  assert.match(prune, /\$monthly\.Count -lt 6/);
});
