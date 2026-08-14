#!/bin/sh
set -eu
umask 077

case "${RESTORE_CONFIRM:-}" in
  RESTORE_EMPTY_TARGET) restore_mode="empty" ;;
  RESTORE_EXISTING_TARGET_FROM_BACKUP) restore_mode="replace" ;;
  *) echo "Falta confirmación exacta de restore" >&2; exit 1 ;;
esac
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

manifest_value_optional() {
  awk -F= -v key="$1" '
    index($0,key "=")==1 { count++; value=substr($0,length(key)+2) }
    END { if(count>1)exit 2; if(count==1)print value }
  ' "$manifest"
}

[ "$(manifest_value RSP_BACKUP_FORMAT)" = "1" ] || { echo "Formato de backup no soportado" >&2; exit 1; }
[ "$(manifest_value STATUS)" = "complete" ] || { echo "El backup no está completo" >&2; exit 1; }
[ "$(manifest_value BUNDLE_ID)" = "$RESTORE_BUNDLE" ] || { echo "El manifest no corresponde al bundle" >&2; exit 1; }
schema_state="$(manifest_value_optional SCHEMA_STATE)"
[ -n "$schema_state" ] || schema_state=managed
case "$schema_state" in managed|legacy-unmanaged) :;;*) echo "Estado de esquema no soportado" >&2;exit 1;;esac
manifest_migrations="$(manifest_value MIGRATIONS)"
if [ "$schema_state" = managed ];then
  printf '%s\n' "$manifest_migrations" | grep -Eq '^[0-9]{3}:[A-Za-z0-9._-]+:[a-f0-9]{64}(,[0-9]{3}:[A-Za-z0-9._-]+:[a-f0-9]{64})*$' || { echo "Metadata de migraciones inválida" >&2;exit 1; }
else
  [ "$manifest_migrations" = legacy-unmanaged ] || { echo "Manifest legacy incoherente" >&2;exit 1; }
fi
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
pg_restore --list "$bundle/$db_file" >/dev/null || { echo "Dump PostgreSQL inválido" >&2;exit 1; }

printf '%s\n' "$PGDATABASE" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$' || { echo "PGDATABASE no es un identificador seguro" >&2;exit 1; }
case "$PGDATABASE" in postgres|template0|template1) echo "No se permite restaurar sobre una DB de mantenimiento" >&2;exit 1;;esac
printf '%s\n' "$PGUSER" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$' || { echo "PGUSER no es un rol seguro" >&2;exit 1; }

listing="/tmp/rsp-restore-list-$$"
trap 'rm -f "$listing"' EXIT HUP INT TERM
tar -tzf "$bundle/$photos_file" > "$listing"
while IFS= read -r item; do
  printf '%s\n' "$item" | grep -Eq '(^/|(^|/)\.\.(/|$))' && exit 1
  printf '%s\n' "$item" | grep -Eq '^fotos(/.*)?$' || exit 1
done < "$listing" || { echo "El archivo de fotos contiene rutas no permitidas" >&2; exit 1; }

mkdir -p /data
if [ "$restore_mode" = "empty" ]; then
  table_count="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
  [ "$table_count" = "0" ] || { echo "Restore rechazado: la base destino no está vacía" >&2; exit 1; }
fi
if [ "$restore_mode" = "empty" ] && [ -d /data/fotos ]; then
  [ -z "$(find /data/fotos -mindepth 1 -maxdepth 1 ! -name .trash -print -quit)" ] || { echo "Restore rechazado: el destino de fotos no está vacío" >&2; exit 1; }
  [ ! -d /data/fotos/.trash ] || [ -z "$(find /data/fotos/.trash -mindepth 1 -print -quit)" ] || { echo "Restore rechazado: .trash no está vacío" >&2; exit 1; }
fi

staging="/data/.rsp-restore-$$"
mkdir "$staging"
trap 'rm -rf "$staging"; rm -f "$listing"' EXIT HUP INT TERM
tar -xzf "$bundle/$photos_file" -C "$staging"
[ -d "$staging/fotos" ] || { echo "El archivo no contiene fotos/" >&2; exit 1; }

if [ "$restore_mode" = "replace" ]; then
  current_owner="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()")"
  current_encoding="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname=current_database()")"
  current_collate="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT datcollate FROM pg_database WHERE datname=current_database()")"
  current_ctype="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT datctype FROM pg_database WHERE datname=current_database()")"
  db_owner="$(manifest_value_optional DATABASE_OWNER)";[ -n "$db_owner" ] || db_owner="$current_owner"
  db_encoding="$(manifest_value_optional DATABASE_ENCODING)";[ -n "$db_encoding" ] || db_encoding="$current_encoding"
  db_collate="$(manifest_value_optional DATABASE_COLLATE)";[ -n "$db_collate" ] || db_collate="$current_collate"
  db_ctype="$(manifest_value_optional DATABASE_CTYPE)";[ -n "$db_ctype" ] || db_ctype="$current_ctype"
  [ "$db_owner" = "$PGUSER" ] || { echo "El owner del backup no coincide con el usuario operativo" >&2;exit 1; }
  printf '%s\n' "$db_owner" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$' || { echo "Owner del backup no permitido" >&2;exit 1; }
  printf '%s\n' "$db_encoding" | grep -Eq '^[A-Z0-9_-]+$' || { echo "Encoding del backup no permitido" >&2;exit 1; }
  for metadata in "$db_collate" "$db_ctype";do [ -n "$metadata" ] && ! printf '%s' "$metadata" | grep -q '[[:cntrl:]]' || { echo "Locale del backup no permitido" >&2;exit 1; };done
  psql --no-psqlrc --quiet --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname=postgres --command="ALTER DATABASE \"$PGDATABASE\" WITH ALLOW_CONNECTIONS false"
  psql --no-psqlrc --quiet --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname=postgres --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$PGDATABASE' AND pid<>pg_backend_pid()"
  dropdb --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --maintenance-db=postgres "$PGDATABASE"
  createdb --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --maintenance-db=postgres --owner="$db_owner" --encoding="$db_encoding" --lc-collate="$db_collate" --lc-ctype="$db_ctype" --template=template0 "$PGDATABASE"
  echo "RESTORE_TARGET_RESET=$PGDATABASE"
fi
if ! pg_restore --exit-on-error --single-transaction --no-owner --no-acl --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" "$bundle/$db_file";then
  echo "RESTORE_FAILED=$RESTORE_BUNDLE MODE=$restore_mode" >&2
  exit 1
fi
if [ "$schema_state" = legacy-unmanaged ]; then
  psql --no-psqlrc --quiet --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="DROP TABLE IF EXISTS public.schema_migrations"
fi
if [ "$schema_state" = managed ]; then
  restored_migrations="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT COALESCE(string_agg(version || ':' || nombre || ':' || btrim(checksum_sha256), ',' ORDER BY version),'') FROM public.schema_migrations")"
  [ "$restored_migrations" = "$manifest_migrations" ] || { echo "El ledger restaurado no coincide con el manifest" >&2; exit 1; }
else
  [ "$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT to_regclass('public.schema_migrations') IS NULL")" = t ] || { echo "El restore legacy creó un ledger inesperado" >&2;exit 1; }
fi
psql --no-psqlrc --quiet --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="ANALYZE"
restored_owner="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()")"
[ "$restored_owner" = "$PGUSER" ] || { echo "Owner restaurado incorrecto" >&2;exit 1; }
[ "$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT COALESCE(bool_and(pg_get_userbyid(relowner)=current_user),true) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')")" = t ] || { echo "Ownership de objetos restaurados incorrecto" >&2;exit 1; }
[ "$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT has_database_privilege(current_user,current_database(),'CONNECT,CREATE,TEMP') AND has_schema_privilege(current_user,'public','USAGE,CREATE')")" = t ] || { echo "Permisos runtime restaurados insuficientes" >&2;exit 1; }
expected_schemas="$(manifest_value_optional SCHEMAS)"
if [ -n "$expected_schemas" ];then restored_schemas="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT COALESCE(string_agg(nspname,',' ORDER BY nspname),'') FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'")";[ "$restored_schemas" = "$expected_schemas" ] || { echo "Schemas restaurados no coinciden con el manifest" >&2;exit 1; };fi
expected_extensions="$(manifest_value_optional EXTENSIONS)"
if [ -n "$expected_extensions" ];then restored_extensions="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT COALESCE(string_agg(extname || ':' || extversion,',' ORDER BY extname),'') FROM pg_extension")";[ "$restored_extensions" = "$expected_extensions" ] || { echo "Extensions restauradas no coinciden con el manifest" >&2;exit 1; };fi

previous="/data/.rsp-previous-$$"
if [ "$restore_mode" = "replace" ] && [ -d /data/fotos ]; then mv /data/fotos "$previous"; fi
if [ "$restore_mode" = "empty" ] && [ -d /data/fotos/.trash ]; then rmdir /data/fotos/.trash; fi
if [ "$restore_mode" = "empty" ] && [ -d /data/fotos ]; then rmdir /data/fotos; fi
if ! mv "$staging/fotos" /data/fotos; then
  [ ! -d "$previous" ] || mv "$previous" /data/fotos
  echo "No se pudo promover el conjunto restaurado de fotografías" >&2
  exit 1
fi
chown -R 1000:1000 /data/fotos
printf 'RSP_PHOTO_STORAGE_LAYOUT=1\n' > /data/.rsp-photo-storage-layout
chown 1000:1000 /data/.rsp-photo-storage-layout
chmod 0640 /data/.rsp-photo-storage-layout
[ ! -d "$previous" ] || rm -rf "$previous"
rmdir "$staging"
rm -f "$listing"
trap - EXIT HUP INT TERM
echo "RESTORE_OK=$RESTORE_BUNDLE MODE=$restore_mode"
