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
case "$schema_state" in managed|legacy-unmanaged) : ;; *) echo "Estado de esquema no soportado" >&2; exit 1 ;; esac
manifest_migrations="$(manifest_value MIGRATIONS)"
if [ "$schema_state" = managed ]; then
  printf '%s\n' "$manifest_migrations" | grep -Eq '^[0-9]{3}:[A-Za-z0-9._-]+:[a-f0-9]{64}(,[0-9]{3}:[A-Za-z0-9._-]+:[a-f0-9]{64})*$' || {
    echo "Metadata de migraciones inválida" >&2
    exit 1
  }
else
  [ "$manifest_migrations" = legacy-unmanaged ] || { echo "Manifest legacy incoherente" >&2; exit 1; }
fi
db_file="$(manifest_value DATABASE_FILE)"
photos_file="$(manifest_value PHOTOS_FILE)"
[ "$db_file" = "database.dump" ] || { echo "Nombre de dump no permitido" >&2; exit 1; }
[ "$photos_file" = "photos.tar.gz" ] || { echo "Nombre de archivo de fotos no permitido" >&2; exit 1; }
[ -f "$bundle/$db_file" ] || { echo "Falta database.dump" >&2; exit 1; }
[ -f "$bundle/$photos_file" ] || { echo "Falta photos.tar.gz" >&2; exit 1; }

db_sha="$(sha256sum "$bundle/$db_file" | awk '{print $1}')"
photos_sha="$(sha256sum "$bundle/$photos_file" | awk '{print $1}')"
[ "$db_sha" = "$(manifest_value DATABASE_SHA256)" ] || { echo "Checksum inválido para PostgreSQL" >&2; exit 1; }
[ "$photos_sha" = "$(manifest_value PHOTOS_SHA256)" ] || { echo "Checksum inválido para fotografías" >&2; exit 1; }
[ "$(wc -c < "$bundle/$db_file" | tr -d ' ')" = "$(manifest_value DATABASE_SIZE)" ] || { echo "Tamaño inválido para PostgreSQL" >&2; exit 1; }
[ "$(wc -c < "$bundle/$photos_file" | tr -d ' ')" = "$(manifest_value PHOTOS_SIZE)" ] || { echo "Tamaño inválido para fotografías" >&2; exit 1; }
pg_restore --list "$bundle/$db_file" >/dev/null || { echo "Dump PostgreSQL inválido" >&2; exit 1; }

printf '%s\n' "$PGDATABASE" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$' || { echo "PGDATABASE no es un identificador seguro" >&2; exit 1; }
case "$PGDATABASE" in postgres|template0|template1) echo "No se permite restaurar sobre una DB de mantenimiento" >&2; exit 1 ;; esac
printf '%s\n' "$PGUSER" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$' || { echo "PGUSER no es un rol seguro" >&2; exit 1; }

listing="/tmp/rsp-restore-list-$$"
staging="/data/.rsp-restore-$$"
bundle_key="$(printf '%s' "$RESTORE_BUNDLE" | sed 's/^rsp-backup-//;s/[TZ]//g')"
previous_photos="/data/.rsp-previous-photos-$bundle_key"
previous_marker="/data/.rsp-previous-layout-$bundle_key"
layout_marker="/data/.rsp-photo-storage-layout"
restore_db="rsp_stage_$bundle_key"
previous_db="rsp_previous_$bundle_key"
lock_dir="/data/.rsp-restore-lock"
photos_previous_preserved=false
marker_previous_preserved=false
photos_new_active=false
marker_new_active=false
db_committed=false
connections_disabled=false
lock_acquired=false
staging_created=false
preserve_staging=false

fail_if_requested() {
  [ "${RESTORE_TEST_FAIL_AT:-}" != "$1" ] || {
    echo "RESTORE_TEST_FAILURE=$1" >&2
    return 1
  }
}

database_exists() {
  [ "$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname=postgres --command="SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='$1')")" = t ]
}

rollback_photos() {
  rollback_ok=true
  if [ "$marker_new_active" = true ] && [ -f "$layout_marker" ]; then
    mv "$layout_marker" "$staging/layout-marker.failed" || rollback_ok=false
    marker_new_active=false
  fi
  if [ "$marker_previous_preserved" = true ] && [ -f "$previous_marker" ]; then
    mv "$previous_marker" "$layout_marker" || rollback_ok=false
    marker_previous_preserved=false
  fi
  if [ "$photos_new_active" = true ] && [ -d /data/fotos ]; then
    mv /data/fotos "$staging/fotos.failed" || rollback_ok=false
    photos_new_active=false
  fi
  if [ "$photos_previous_preserved" = true ] && [ -d "$previous_photos" ]; then
    mv "$previous_photos" /data/fotos || rollback_ok=false
    photos_previous_preserved=false
  fi
  [ "$rollback_ok" = true ]
}

on_exit() {
  code=$?
  trap - EXIT HUP INT TERM
  if [ "$code" -ne 0 ]; then
    if [ "$db_committed" != true ]; then
      if ! rollback_photos; then
        preserve_staging=true
        echo "RESTORE_COMPENSATION_FAILED=photos" >&2
      fi
      if [ "$connections_disabled" = true ] && database_exists "$PGDATABASE"; then
        psql --no-psqlrc --quiet --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname=postgres --command="ALTER DATABASE \"$PGDATABASE\" WITH ALLOW_CONNECTIONS true" >/dev/null 2>&1 || true
      fi
      if database_exists "$restore_db"; then
        dropdb --if-exists --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --maintenance-db=postgres "$restore_db" >/dev/null 2>&1 || true
      fi
    fi
    echo "RESTORE_FAILED=$RESTORE_BUNDLE MODE=$restore_mode" >&2
  fi
  rm -f "$listing"
  if [ "$staging_created" = true ] && [ "$preserve_staging" != true ]; then rm -rf "$staging"; fi
  if [ "$lock_acquired" = true ]; then rmdir "$lock_dir" >/dev/null 2>&1 || true; fi
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' HUP INT TERM

tar -tzf "$bundle/$photos_file" > "$listing"
while IFS= read -r item; do
  printf '%s\n' "$item" | grep -Eq '(^/|(^|/)\.\.(/|$))' && exit 1
  printf '%s\n' "$item" | grep -Eq '^fotos(/.*)?$' || exit 1
done < "$listing" || { echo "El archivo de fotos contiene rutas no permitidas" >&2; exit 1; }

mkdir -p /data
if [ "$restore_mode" = empty ]; then
  table_count="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
  [ "$table_count" = 0 ] || { echo "Restore rechazado: la base destino no está vacía" >&2; exit 1; }
  if [ -d /data/fotos ]; then
    [ -z "$(find /data/fotos -mindepth 1 -maxdepth 1 ! -name .trash -print -quit)" ] || { echo "Restore rechazado: el destino de fotos no está vacío" >&2; exit 1; }
    [ ! -d /data/fotos/.trash ] || [ -z "$(find /data/fotos/.trash -mindepth 1 -print -quit)" ] || { echo "Restore rechazado: .trash no está vacío" >&2; exit 1; }
  fi
fi

mkdir "$lock_dir" || { echo "Ya existe otra operación de restore o un lock pendiente" >&2; exit 1; }
lock_acquired=true
mkdir "$staging"
staging_created=true
if [ -d "$previous_photos" ]; then rm -rf "$previous_photos"; fi
if [ -f "$previous_marker" ]; then rm -f "$previous_marker"; fi
tar -xzf "$bundle/$photos_file" -C "$staging"
[ -d "$staging/fotos" ] || { echo "El archivo no contiene fotos/" >&2; exit 1; }
[ -z "$(find "$staging/fotos" -type l -print -quit)" ] || { echo "El archivo de fotos contiene symlinks no permitidos" >&2; exit 1; }
chown -R 1000:1000 "$staging/fotos"
printf 'RSP_PHOTO_STORAGE_LAYOUT=1\n' > "$staging/layout-marker"
chown 1000:1000 "$staging/layout-marker"
chmod 0640 "$staging/layout-marker"

current_owner="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()")"
current_encoding="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname=current_database()")"
current_collate="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT datcollate FROM pg_database WHERE datname=current_database()")"
current_ctype="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT datctype FROM pg_database WHERE datname=current_database()")"
db_owner="$(manifest_value_optional DATABASE_OWNER)"; [ -n "$db_owner" ] || db_owner="$current_owner"
db_encoding="$(manifest_value_optional DATABASE_ENCODING)"; [ -n "$db_encoding" ] || db_encoding="$current_encoding"
db_collate="$(manifest_value_optional DATABASE_COLLATE)"; [ -n "$db_collate" ] || db_collate="$current_collate"
db_ctype="$(manifest_value_optional DATABASE_CTYPE)"; [ -n "$db_ctype" ] || db_ctype="$current_ctype"
[ "$db_owner" = "$PGUSER" ] || { echo "El owner del backup no coincide con el usuario operativo" >&2; exit 1; }
printf '%s\n' "$db_owner" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$' || { echo "Owner del backup no permitido" >&2; exit 1; }
printf '%s\n' "$db_encoding" | grep -Eq '^[A-Z0-9_-]+$' || { echo "Encoding del backup no permitido" >&2; exit 1; }
for metadata in "$db_collate" "$db_ctype"; do
  [ -n "$metadata" ] && ! printf '%s' "$metadata" | grep -q '[[:cntrl:]]' || { echo "Locale del backup no permitido" >&2; exit 1; }
done

if database_exists "$restore_db"; then dropdb --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --maintenance-db=postgres "$restore_db"; fi
if database_exists "$previous_db"; then
  echo "RESTORE_CLEANUP_RESIDUE=$previous_db" >&2
  dropdb --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --maintenance-db=postgres "$previous_db"
fi
createdb --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --maintenance-db=postgres --owner="$db_owner" --encoding="$db_encoding" --lc-collate="$db_collate" --lc-ctype="$db_ctype" --template=template0 "$restore_db"
if ! fail_if_requested db_restore || ! pg_restore --exit-on-error --single-transaction --no-owner --no-acl --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$restore_db" "$bundle/$db_file"; then
  echo "No se pudo restaurar la DB de staging" >&2
  exit 1
fi
if [ "$schema_state" = legacy-unmanaged ]; then
  psql --no-psqlrc --quiet --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$restore_db" --command="DROP TABLE IF EXISTS public.schema_migrations"
fi
if [ "$schema_state" = managed ]; then
  restored_migrations="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$restore_db" --command="SELECT COALESCE(string_agg(version || ':' || nombre || ':' || btrim(checksum_sha256), ',' ORDER BY version),'') FROM public.schema_migrations")"
  [ "$restored_migrations" = "$manifest_migrations" ] || { echo "El ledger restaurado no coincide con el manifest" >&2; exit 1; }
else
  [ "$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$restore_db" --command="SELECT to_regclass('public.schema_migrations') IS NULL")" = t ] || { echo "El restore legacy creó un ledger inesperado" >&2; exit 1; }
fi
psql --no-psqlrc --quiet --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$restore_db" --command="ANALYZE"
restored_owner="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$restore_db" --command="SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()")"
[ "$restored_owner" = "$PGUSER" ] || { echo "Owner restaurado incorrecto" >&2; exit 1; }
[ "$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$restore_db" --command="SELECT COALESCE(bool_and(pg_get_userbyid(relowner)=current_user),true) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')")" = t ] || { echo "Ownership de objetos restaurados incorrecto" >&2; exit 1; }
[ "$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$restore_db" --command="SELECT has_database_privilege(current_user,current_database(),'CONNECT,CREATE,TEMP') AND has_schema_privilege(current_user,'public','USAGE,CREATE')")" = t ] || { echo "Permisos runtime restaurados insuficientes" >&2; exit 1; }
expected_schemas="$(manifest_value_optional SCHEMAS)"
if [ -n "$expected_schemas" ]; then
  restored_schemas="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$restore_db" --command="SELECT COALESCE(string_agg(nspname,',' ORDER BY nspname),'') FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'")"
  [ "$restored_schemas" = "$expected_schemas" ] || { echo "Schemas restaurados no coinciden con el manifest" >&2; exit 1; }
fi
expected_extensions="$(manifest_value_optional EXTENSIONS)"
if [ -n "$expected_extensions" ]; then
  restored_extensions="$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$restore_db" --command="SELECT COALESCE(string_agg(extname || ':' || extversion,',' ORDER BY extname),'') FROM pg_extension")"
  [ "$restored_extensions" = "$expected_extensions" ] || { echo "Extensions restauradas no coinciden con el manifest" >&2; exit 1; }
fi
echo "RESTORE_DB_STAGED=$RESTORE_BUNDLE"

fail_if_requested before_current_move
if [ -d /data/fotos ]; then mv /data/fotos "$previous_photos"; photos_previous_preserved=true; fi
fail_if_requested after_current_preserved
fail_if_requested before_staged_switch
mv "$staging/fotos" /data/fotos
photos_new_active=true
if [ -f "$layout_marker" ]; then mv "$layout_marker" "$previous_marker"; marker_previous_preserved=true; fi
mv "$staging/layout-marker" "$layout_marker"
marker_new_active=true
fail_if_requested after_photo_switch

fail_if_requested before_db_swap
psql --no-psqlrc --quiet --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname=postgres --command="ALTER DATABASE \"$PGDATABASE\" WITH ALLOW_CONNECTIONS false"
connections_disabled=true
psql --no-psqlrc --quiet --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname=postgres --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$PGDATABASE' AND pid<>pg_backend_pid()"
if [ "${RESTORE_TEST_FAIL_AT:-}" = after_target_preserved ]; then
  echo "RESTORE_TEST_FAILURE=after_target_preserved" >&2
  if psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --single-transaction --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname=postgres \
    --command="ALTER DATABASE \"$PGDATABASE\" RENAME TO \"$previous_db\"" \
    --command="SELECT 1/0" \
    --command="ALTER DATABASE \"$restore_db\" RENAME TO \"$PGDATABASE\""; then :; else exit 1; fi
else
  psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --single-transaction --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname=postgres \
    --command="ALTER DATABASE \"$PGDATABASE\" RENAME TO \"$previous_db\"" \
    --command="ALTER DATABASE \"$restore_db\" RENAME TO \"$PGDATABASE\""
fi
connections_disabled=false
db_committed=true
echo "RESTORE_TARGET_SWITCHED=$PGDATABASE"

cleanup_pending=false
if [ "${RESTORE_TEST_FAIL_AT:-}" = after_db_swap ] || [ "${RESTORE_TEST_FAIL_AT:-}" = cleanup ]; then
  cleanup_pending=true
else
  dropdb --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --maintenance-db=postgres "$previous_db" || cleanup_pending=true
  if [ -d "$previous_photos" ]; then rm -rf "$previous_photos" || cleanup_pending=true; fi
  if [ -f "$previous_marker" ]; then rm -f "$previous_marker" || cleanup_pending=true; fi
fi
if [ "$cleanup_pending" = true ]; then
  echo "RESTORE_CLEANUP_PENDING=$RESTORE_BUNDLE DB=$previous_db PHOTOS=$previous_photos" >&2
fi

rm -f "$listing"
rmdir "$staging"
rmdir "$lock_dir"
lock_acquired=false
trap - EXIT HUP INT TERM
echo "RESTORE_OK=$RESTORE_BUNDLE MODE=$restore_mode"
