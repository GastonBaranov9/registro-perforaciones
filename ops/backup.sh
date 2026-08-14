#!/bin/sh
set -eu
umask 077

case "${APP_VERSION:-unknown}" in
  *[!A-Za-z0-9._-]*) echo "APP_VERSION contiene caracteres no permitidos" >&2; exit 1 ;;
esac

[ -d /backups ] || { echo "El destino /backups no existe" >&2; exit 1; }
[ -d /data/fotos ] || { echo "El volumen no contiene el directorio fotos" >&2; exit 1; }

bundle_id="rsp-backup-$(date -u +%Y%m%dT%H%M%SZ)"
final="/backups/$bundle_id"
temporal="/backups/.$bundle_id.$$.tmp"
[ ! -e "$final" ] || { echo "Ya existe un backup con el mismo timestamp" >&2; exit 1; }
mkdir "$temporal"
trap 'rm -rf "$temporal"' EXIT HUP INT TERM

dump_name="database.dump"
photos_name="photos.tar.gz"
pg_dump --format=custom --no-owner --no-acl --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --file="$temporal/$dump_name"
tar -C /data -czf "$temporal/$photos_name" fotos

ledger_exists="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'false' ELSE 'true' END")"
if [ "$ledger_exists" = true ]; then
  migrations="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT COALESCE(string_agg(version || ':' || nombre || ':' || btrim(checksum_sha256), ',' ORDER BY version),'') FROM public.schema_migrations")"
  [ -n "$migrations" ] || { echo "La base no tiene un ledger de migraciones válido" >&2; exit 1; }
  schema_state=managed
elif [ "$ledger_exists" = false ]; then
  table_count="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename <> 'schema_migrations'")"
  [ "$table_count" -gt 0 ] || { echo "La base sin ledger tampoco contiene un esquema legacy" >&2; exit 1; }
  migrations=legacy-unmanaged
  schema_state=legacy-unmanaged
else
  echo "No se pudo clasificar el estado de migraciones" >&2
  exit 1
fi

db_sha="$(sha256sum "$temporal/$dump_name" | awk '{print $1}')"
photos_sha="$(sha256sum "$temporal/$photos_name" | awk '{print $1}')"
db_size="$(wc -c < "$temporal/$dump_name" | tr -d ' ')"
photos_size="$(wc -c < "$temporal/$photos_name" | tr -d ' ')"
created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$temporal/manifest.txt" <<EOF
RSP_BACKUP_FORMAT=1
STATUS=complete
BUNDLE_ID=$bundle_id
CREATED_AT_UTC=$created_at
APP_VERSION=${APP_VERSION:-unknown}
SCHEMA_STATE=$schema_state
DATABASE_FILE=$dump_name
DATABASE_SHA256=$db_sha
DATABASE_SIZE=$db_size
PHOTOS_FILE=$photos_name
PHOTOS_SHA256=$photos_sha
PHOTOS_SIZE=$photos_size
MIGRATIONS=$migrations
EOF

sync
mv "$temporal" "$final"
trap - EXIT HUP INT TERM
echo "BACKUP_BUNDLE=$bundle_id"
