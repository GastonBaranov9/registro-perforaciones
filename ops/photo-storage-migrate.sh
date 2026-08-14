#!/bin/sh
set -eu
umask 077

: "${PGHOST:?Falta PGHOST}"
: "${PGPORT:?Falta PGPORT}"
: "${PGUSER:?Falta PGUSER}"
: "${PGDATABASE:?Falta PGDATABASE}"

root=/data
photos="$root/fotos"
trash="$photos/.trash"
marker="$root/.rsp-photo-storage-layout"
legacy=/legacy
refs="/tmp/rsp-photo-refs-$$"
copy_tmp="$root/.rsp-photo-copy-$$"
copied=0
identical=0
orphans=0

cleanup() {
  rm -f "$refs" "$copy_tmp"
}
trap cleanup EXIT HUP INT TERM

fail() {
  echo "PHOTO_STORAGE_FAILED: $1" >&2
  exit 1
}

is_photo_name() {
  printf '%s\n' "$1" | grep -Eiq '^pozo-[1-9][0-9]*\.(jpg|jpeg|png)$'
}

copy_verified() {
  source_file=$1
  destination_file=$2
  [ -f "$source_file" ] && [ ! -L "$source_file" ] || fail "la fuente contiene una entrada no regular"
  if [ -e "$destination_file" ] || [ -L "$destination_file" ]; then
    [ -f "$destination_file" ] && [ ! -L "$destination_file" ] || fail "el destino contiene una entrada no regular"
    [ "$(wc -c < "$source_file" | tr -d ' ')" = "$(wc -c < "$destination_file" | tr -d ' ')" ] || fail "conflicto de tamaño entre fuente y volumen"
    [ "$(sha256sum "$source_file" | awk '{print $1}')" = "$(sha256sum "$destination_file" | awk '{print $1}')" ] || fail "conflicto de contenido entre fuente y volumen"
    identical=$((identical + 1))
    return
  fi
  cp "$source_file" "$copy_tmp"
  [ "$(wc -c < "$source_file" | tr -d ' ')" = "$(wc -c < "$copy_tmp" | tr -d ' ')" ] || fail "la copia cambió de tamaño"
  [ "$(sha256sum "$source_file" | awk '{print $1}')" = "$(sha256sum "$copy_tmp" | awk '{print $1}')" ] || fail "la copia cambió de checksum"
  chown 1000:1000 "$copy_tmp"
  chmod 0640 "$copy_tmp"
  mv "$copy_tmp" "$destination_file"
  copied=$((copied + 1))
  if [ -n "${PHOTO_STORAGE_TEST_FAIL_AFTER:-}" ] && [ "$copied" -ge "$PHOTO_STORAGE_TEST_FAIL_AFTER" ]; then
    case "${PHOTO_STORAGE_PROJECT_NAME:-}" in rsp07f-r3-*) fail "fallo de copia controlado";; *) fail "inyección de fallo no permitida";; esac
  fi
}

mkdir -p "$root"
[ ! -L "$root" ] || fail "la raíz del volumen no puede ser symlink"
if [ -e "$photos" ] || [ -L "$photos" ]; then
  [ -d "$photos" ] && [ ! -L "$photos" ] || fail "fotos no es un directorio seguro"
else
  mkdir "$photos"
fi
if [ -e "$trash" ] || [ -L "$trash" ]; then
  [ -d "$trash" ] && [ ! -L "$trash" ] || fail ".trash no es un directorio seguro"
else
  mkdir "$trash"
fi
chown 1000:1000 "$photos" "$trash"
chmod 0750 "$photos" "$trash"

psql --no-psqlrc --tuples-only --no-align \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
  --command="SELECT id_pozo FROM public.pozo WHERE foto_url IS NOT NULL ORDER BY id_pozo" > "$refs"

ledger="$(psql --no-psqlrc --tuples-only --no-align \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
  --command="SELECT CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'absent' ELSE 'present' END")"
case "$ledger" in present|absent) :;; *) fail "no se pudo clasificar el ledger";; esac

if [ -d "$legacy" ] && [ ! -L "$legacy" ]; then
  for source_file in "$legacy"/pozo-*; do
    [ -e "$source_file" ] || [ -L "$source_file" ] || continue
    base="$(basename "$source_file")"
    is_photo_name "$base" || continue
    copy_verified "$source_file" "$photos/$base"
  done
  if [ -e "$legacy/.trash" ] || [ -L "$legacy/.trash" ]; then
    [ -d "$legacy/.trash" ] && [ ! -L "$legacy/.trash" ] || fail "el .trash legacy no es seguro"
    for source_file in "$legacy/.trash"/*; do
      [ -e "$source_file" ] || [ -L "$source_file" ] || continue
      base="$(basename "$source_file")"
      printf '%s\n' "$base" | grep -Eq '^[A-Za-z0-9._-]+$' || fail "nombre inseguro en .trash legacy"
      copy_verified "$source_file" "$trash/$base"
    done
  fi
elif [ "${PHOTO_LEGACY_SOURCE_STATUS:-unavailable}" = available ]; then
  fail "la fuente legacy declarada disponible no es un directorio seguro"
fi

for destination_file in "$photos"/*; do
  [ -e "$destination_file" ] || [ -L "$destination_file" ] || continue
  [ -f "$destination_file" ] && [ ! -L "$destination_file" ] || fail "el volumen contiene una entrada no regular"
  base="$(basename "$destination_file")"
  is_photo_name "$base" || fail "el volumen contiene un archivo no permitido"
done
for destination_file in "$trash"/*; do
  [ -e "$destination_file" ] || [ -L "$destination_file" ] || continue
  [ -f "$destination_file" ] && [ ! -L "$destination_file" ] || fail ".trash contiene una entrada no regular"
done

while IFS= read -r id; do
  [ -n "$id" ] || continue
  count=0
  for destination_file in "$photos"/*; do
    [ -f "$destination_file" ] || continue
    if printf '%s\n' "$(basename "$destination_file")" | grep -Eiq "^pozo-$id\\.(jpg|jpeg|png)$";then count=$((count + 1));fi
  done
  [ "$count" -eq 1 ] || {
    if [ "$count" -eq 0 ] && [ "${PHOTO_LEGACY_SOURCE_STATUS:-unavailable}" != available ]; then
      fail "DB referencia una foto ausente y la fuente legacy no está disponible"
    fi
    [ "$count" -eq 0 ] && fail "DB referencia una foto que no existe en la fuente ni en el volumen"
    fail "el volumen contiene más de una foto para un pozo referenciado"
  }
done < "$refs"

for destination_file in "$photos"/pozo-*; do
  [ -f "$destination_file" ] || continue
  id="$(basename "$destination_file" | sed -n 's/^pozo-\([1-9][0-9]*\)\..*$/\1/p')"
  [ -n "$id" ] || continue
  grep -Fxq "$id" "$refs" || orphans=$((orphans + 1))
done

marker_tmp="$root/.rsp-photo-storage-layout.$$.tmp"
printf 'RSP_PHOTO_STORAGE_LAYOUT=1\n' > "$marker_tmp"
chown 1000:1000 "$marker_tmp"
chmod 0640 "$marker_tmp"
mv "$marker_tmp" "$marker"
references="$(grep -c . "$refs" 2>/dev/null || true)"
trap - EXIT HUP INT TERM
cleanup

mode=migrated
[ "$copied" -gt 0 ] || mode=existing
[ "$references" -gt 0 ] || { [ "$copied" -gt 0 ] || mode=initialized_empty; }
echo "PHOTO_STORAGE_READY MODE=$mode COPIED=$copied IDENTICAL=$identical ORPHANS=$orphans DB_REFERENCES=$references DB_LEDGER=$ledger"
