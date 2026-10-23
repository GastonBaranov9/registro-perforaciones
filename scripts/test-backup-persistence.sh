#!/bin/sh
# Invoked only inside the isolated container created by the .mjs runner.
set -eu
[ "$PGDATABASE:$PGUSER:$PGHOST" = fixture:fixture:127.0.0.1 ]
[ -d /source-ops ] && [ ! -e /ops ] && [ ! -e /data ] && [ ! -e /backups ]
mkdir /ops /data /backups /mock-bin
for f in backup.sh restore.sh persistence.sh backup-state.sql; do tr -d '\r' < "/source-ops/$f" > "/ops/$f"; done
for f in /ops/*.sh; do sh -n "$f"; done
mkdir -p /data/fotos/.trash /data/reset-quarantine-fixture /data/other/empty
printf 'photo\n' > '/data/fotos/photo with space.jpg'
printf 'quarantined\n' > /data/reset-quarantine-fixture/record.bin
printf 'additional\n' > /data/other/extra.bin
printf 'hidden\n' > /data/.hidden
printf 'RSP_PHOTO_STORAGE_LAYOUT=1\n' > /data/.rsp-photo-storage-layout
chown -R 1000:1000 /data
chmod 0750 /data
psql -Xq --set=ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE schema_migrations(version text, nombre text, checksum_sha256 text);
INSERT INTO schema_migrations VALUES ('017','fixture.sql',repeat('a',64));
CREATE TABLE owners(id int PRIMARY KEY);
CREATE TABLE records(id int PRIMARY KEY, owner_id int REFERENCES owners);
INSERT INTO owners VALUES (1);
INSERT INTO records VALUES (3281,1),(3280,NULL);
CREATE SEQUENCE numeration START 3282;
SQL
. /ops/persistence.sh
persistence_inventory /data /tmp/source.inventory
grep -q './reset-quarantine-fixture/record.bin$' /tmp/source.inventory
grep -q './other/extra.bin$' /tmp/source.inventory
grep -q './.hidden$' /tmp/source.inventory
sh /ops/backup.sh >/tmp/backup.log 2>&1 || { cat /tmp/backup.log; exit 1; }
bundle=$(sed -n 's/^BACKUP_VERIFIED_FULL=//p' /tmp/backup.log)
[ -n "$bundle" ]
(cd "/backups/$bundle" && sha256sum -c SHA256SUMS >/dev/null)
cmp /tmp/source.inventory "/backups/$bundle/persistence.inventory"
[ ! -e "/backups/$bundle/photos.tar.gz" ]
echo 'PASS full backup: PostgreSQL, fotos, quarantine, extra, hidden, empty directory, checksums'

# Genuine restore into a new empty database/filesystem, using the production restorer.
mv /data /source-data; mkdir /data
createdb restore_fixture
PGDATABASE=restore_fixture RESTORE_BUNDLE="$bundle" RESTORE_CONFIRM=RESTORE_EMPTY_TARGET sh /ops/restore.sh >/tmp/restore.log 2>&1 || { cat /tmp/restore.log; exit 1; }
persistence_inventory /data /tmp/restored.inventory
cmp /tmp/source.inventory /tmp/restored.inventory
[ "$(PGDATABASE=restore_fixture psql -XAt -c 'SELECT last_value FROM numeration')" = 3282 ]
[ "$(PGDATABASE=restore_fixture psql -XAt -c 'SELECT count(*) FROM records')" = 2 ]
echo 'PASS full restore: all files, rows, relationships and sequence unchanged'

# Compensation includes arbitrary top-level files, not only fotos.
printf 'keep\n' > /data/target-only.bin
PGDATABASE=restore_fixture psql -Xq -c 'INSERT INTO owners VALUES (2)'
persistence_inventory /data /tmp/target.inventory
if PGDATABASE=restore_fixture RESTORE_BUNDLE="$bundle" RESTORE_CONFIRM=RESTORE_EXISTING_TARGET_FROM_BACKUP RESTORE_TEST_FAIL_AT=after_photo_switch sh /ops/restore.sh >/tmp/failure.log 2>&1; then exit 1; fi
grep -q RESTORE_TEST_FAILURE=after_photo_switch /tmp/failure.log
persistence_inventory /data /tmp/compensated.inventory
cmp /tmp/target.inventory /tmp/compensated.inventory
[ "$(PGDATABASE=restore_fixture psql -XAt -c 'SELECT count(*) FROM owners')" = 2 ]
echo 'PASS failed restore compensates full filesystem and preserves target database'

# Legacy format-1 bundle still restores with its original fotos-only semantics.
legacy=rsp-backup-20000101T000000Z
mkdir "/backups/$legacy"
cp "/backups/$bundle/database.dump" "/backups/$legacy/"
tar -C /source-data -czf "/backups/$legacy/photos.tar.gz" fotos
sha=$(sha256sum "/backups/$legacy/photos.tar.gz"); sha=${sha%% *}
size=$(wc -c < "/backups/$legacy/photos.tar.gz" | tr -d ' ')
sed -e 's/RSP_BACKUP_FORMAT=2/RSP_BACKUP_FORMAT=1/' -e "s/BUNDLE_ID=.*/BUNDLE_ID=$legacy/" \
  -e 's/PERSISTENCE_FILE=.*/PHOTOS_FILE=photos.tar.gz/' -e "s/PERSISTENCE_SHA256=.*/PHOTOS_SHA256=$sha/" \
  -e "s/PERSISTENCE_SIZE=.*/PHOTOS_SIZE=$size/" "/backups/$bundle/manifest.txt" > "/backups/$legacy/manifest.txt"
mv /data /restored-data; mkdir /data
createdb legacy_fixture
PGDATABASE=legacy_fixture RESTORE_BUNDLE="$legacy" RESTORE_CONFIRM=RESTORE_EMPTY_TARGET sh /ops/restore.sh >/tmp/legacy.log 2>&1 || { cat /tmp/legacy.log; exit 1; }
cmp '/data/fotos/photo with space.jpg' '/source-data/fotos/photo with space.jpg'
echo 'PASS legacy format-1 restore'
mv /data /legacy-data; mv /source-data /data

# Faults are injected only through local executable mocks, never production hooks.
cat > /mock-bin/tar <<'SH'
#!/bin/sh
case "$CASE:$*" in
  copy:*-czf*) exit 23;;
  missing:*-czf*) exec /bin/tar -C /data -czf "$4" ./fotos;;
  integrity:*-czf*) /bin/tar "$@"; printf broken > "$4"; exit 0;;
esac
exec /bin/tar "$@"
SH
cat > /mock-bin/pg_dump <<'SH'
#!/bin/sh
[ "$CASE" != dump ] || exit 23
/usr/local/bin/pg_dump "$@"
if [ "$CASE" = changed ]; then printf unexpected >> /data/other/extra.bin; fi
if [ "$CASE" = dbchanged ]; then psql -Xq -c 'INSERT INTO owners VALUES (999)'; fi
SH
chmod +x /mock-bin/*
# Separate output directory for each attempt avoids timestamp collisions.
mv /backups /good-backups
for scenario in dump copy missing integrity changed dbchanged; do
  mkdir /backups
  if CASE="$scenario" PATH="/mock-bin:$PATH" sh /ops/backup.sh >/tmp/failure.log 2>&1; then cat /tmp/failure.log; exit 1; fi
  if grep -q 'BACKUP_BUNDLE=\|BACKUP_VERIFIED_FULL=' /tmp/failure.log; then exit 1; fi
  [ -z "$(find /backups -mindepth 1 -print -quit)" ]
  rmdir /backups
  echo "PASS fail-closed backup/$scenario"
done
mkdir /backups
# An independent DB client prevents claiming a quiescent source.
psql -Xq -c 'SELECT pg_sleep(3)' >/tmp/client.log 2>&1 & client=$!
sleep 1
if sh /ops/backup.sh >/tmp/failure.log 2>&1; then exit 1; fi
grep -q 'pausa de escrituras' /tmp/failure.log
wait "$client"
echo 'PASS concurrent database client rejected'
rmdir /backups
ln -s /backup-host /backups
sh /ops/backup.sh >/tmp/host-backup.log 2>&1 || { cat /tmp/host-backup.log; exit 1; }
host_bundle=$(sed -n 's/^BACKUP_VERIFIED_FULL=//p' /tmp/host-backup.log)
[ -n "$host_bundle" ]
(cd "/backups/$host_bundle" && sha256sum -c SHA256SUMS >/dev/null)
echo 'PASS host bind-mount backup (Windows compatible, POSIX extraction stays isolated)'
echo 'BACKUP_PERSISTENCE_TESTS_OK 12/12'
