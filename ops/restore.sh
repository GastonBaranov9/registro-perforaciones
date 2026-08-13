#!/bin/sh
set -eu
umask 077

[ "${RESTORE_CONFIRM:-}" = "RESTORE_EMPTY_TARGET" ] || { echo "Falta confirmación exacta RESTORE_EMPTY_TARGET" >&2; exit 1; }
printf '%s\n' "${RESTORE_BUNDLE:-}" | grep -Eq '^rsp-backup-[0-9]{8}T[0-9]{6}Z$' || {
  echo "RESTORE_BUNDLE no es un bundle reconocido" >&2
  exit 1
}

bundle="/backups/$RESTORE_BUNDLE"
manifest="$bundle/manifest.txt"
[ -f "$manifest" ] || { echo "Falta manifest.txt" >&2; exit 1; }

manifest_value() {
  awk -F= -v key="$1" '
    index($0,key "=")==1 { count++; print substr($0,length(key)+2) }
    END { if(count != 1) exit 2 }
  ' "$manifest"
}

[ "$(manifest_value RSP_BACKUP_FORMAT)" = "1" ] || { echo "Formato de backup no soportado" >&2; exit 1; }
[ "$(manifest_value STATUS)" = "complete" ] || { echo "El backup no está completo" >&2; exit 1; }
[ "$(manifest_value BUNDLE_ID)" = "$RESTORE_BUNDLE" ] || { echo "El manifest no corresponde al bundle" >&2; exit 1; }
db_file="$(manifest_value DATABASE_FILE)"
photos_file="$(manifest_value PHOTOS_FILE)"
[ "$db_file" = "database.dump" ] || { echo "Nombre de dump no permitido" >&2; exit 1; }
[ "$photos_file" = "photos.tar.gz" ] || { echo "Nombre de archivo de fotos no permitido" >&2; exit 1; }

db_sha="$(sha256sum "$bundle/$db_file" | awk '{print $1}')"
photos_sha="$(sha256sum "$bundle/$photos_file" | awk '{print $1}')"
[ "$db_sha" = "$(manifest_value DATABASE_SHA256)" ] || { echo "Checksum inválido para PostgreSQL" >&2; exit 1; }
[ "$photos_sha" = "$(manifest_value PHOTOS_SHA256)" ] || { echo "Checksum inválido para fotografías" >&2; exit 1; }
[ "$(wc -c < "$bundle/$db_file" | tr -d ' ')" = "$(manifest_value DATABASE_SIZE)" ] || { echo "Tamaño inválido para PostgreSQL" >&2; exit 1; }
[ "$(wc -c < "$bundle/$photos_file" | tr -d ' ')" = "$(manifest_value PHOTOS_SIZE)" ] || { echo "Tamaño inválido para fotografías" >&2; exit 1; }

listing="/tmp/rsp-restore-list-$$"
trap 'rm -f "$listing"' EXIT HUP INT TERM
tar -tzf "$bundle/$photos_file" > "$listing"
while IFS= read -r item; do
  printf '%s\n' "$item" | grep -Eq '(^/|(^|/)\.\.(/|$))' && exit 1
  printf '%s\n' "$item" | grep -Eq '^fotos(/.*)?$' || exit 1
done < "$listing" || { echo "El archivo de fotos contiene rutas no permitidas" >&2; exit 1; }

table_count="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
[ "$table_count" = "0" ] || { echo "Restore rechazado: la base destino no está vacía" >&2; exit 1; }

mkdir -p /data
if [ -d /data/fotos ]; then
  [ -z "$(find /data/fotos -mindepth 1 -maxdepth 1 ! -name .trash -print -quit)" ] || { echo "Restore rechazado: el destino de fotos no está vacío" >&2; exit 1; }
  [ ! -d /data/fotos/.trash ] || [ -z "$(find /data/fotos/.trash -mindepth 1 -print -quit)" ] || { echo "Restore rechazado: .trash no está vacío" >&2; exit 1; }
fi

staging="/data/.rsp-restore-$$"
mkdir "$staging"
trap 'rm -rf "$staging"; rm -f "$listing"' EXIT HUP INT TERM
tar -xzf "$bundle/$photos_file" -C "$staging"
[ -d "$staging/fotos" ] || { echo "El archivo no contiene fotos/" >&2; exit 1; }

pg_restore --exit-on-error --single-transaction --no-owner --no-acl --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" "$bundle/$db_file"
restored_migrations="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT COALESCE(string_agg(version || ':' || nombre || ':' || btrim(checksum_sha256), ',' ORDER BY version),'') FROM public.schema_migrations")"
[ "$restored_migrations" = "$(manifest_value MIGRATIONS)" ] || { echo "El ledger restaurado no coincide con el manifest" >&2; exit 1; }
psql --no-psqlrc --quiet --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="ANALYZE"

if [ -d /data/fotos/.trash ]; then rmdir /data/fotos/.trash; fi
if [ -d /data/fotos ]; then rmdir /data/fotos; fi
mv "$staging/fotos" /data/fotos
chown -R 1000:1000 /data/fotos
rmdir "$staging"
rm -f "$listing"
trap - EXIT HUP INT TERM
echo "RESTORE_OK=$RESTORE_BUNDLE"
