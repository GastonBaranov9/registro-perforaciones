#!/bin/sh
set -eu
umask 077

: "${PGHOST:?Falta PGHOST}"
: "${PGPORT:?Falta PGPORT}"
: "${PGUSER:?Falta PGUSER}"
: "${PGDATABASE:?Falta PGDATABASE}"

root=/data
photos="$root/fotos"
marker="$root/.rsp-photo-storage-layout"
legacy=/legacy
refs="/tmp/rsp-photo-refs-$$"
source_manifest="/tmp/rsp-photo-source-$$"
destination_manifest="/tmp/rsp-photo-destination-$$"
verified_manifest="/tmp/rsp-photo-verified-$$"
stage_root="$root/.rsp-photo-stage-$$"
stage_photos="$stage_root/fotos"
previous="$root/.rsp-photo-previous-$$"
failed_new="$root/.rsp-photo-failed-$$"
promotion_started=false
promotion_complete=false
staged=0
copied=0
updated=0
removed=0
unchanged=0
orphans=0

fail() {
  echo "PHOTO_STORAGE_FAILED: $1" >&2
  exit 1
}

cleanup() {
  if [ "$promotion_started" = true ] && [ "$promotion_complete" != true ]; then
    if [ -d "$previous" ] && [ ! -L "$previous" ]; then
      if [ -d "$photos" ] && [ ! -L "$photos" ]; then mv "$photos" "$failed_new" 2>/dev/null || true; fi
      if [ ! -e "$photos" ] && [ ! -L "$photos" ]; then mv "$previous" "$photos" 2>/dev/null || true; fi
      rm -rf "$failed_new"
    fi
  fi
  rm -rf "$stage_root"
  rm -f "$refs" "$source_manifest" "$destination_manifest" "$verified_manifest"
}
trap cleanup EXIT HUP INT TERM

is_photo_name() { printf '%s\n' "$1" | grep -Eiq '^pozo-[1-9][0-9]*\.(jpg|jpeg|png)$'; }

test_failure() {
  [ "${PHOTO_STORAGE_TEST_FAIL_AT:-}" = "$1" ] || return 0
  case "${PHOTO_STORAGE_PROJECT_NAME:-}" in rsp07f-r3-*) fail "fallo controlado en $1";; *) fail "inyeccion de fallo no permitida";; esac
}

validate_tree() {
  tree=$1
  [ -d "$tree" ] && [ ! -L "$tree" ] || fail "fotos no es un directorio seguro"
  tree_trash="$tree/.trash"
  [ -d "$tree_trash" ] && [ ! -L "$tree_trash" ] || fail ".trash no es un directorio seguro"
  for candidate in "$tree"/*; do
    [ -e "$candidate" ] || [ -L "$candidate" ] || continue
    base=$(basename "$candidate")
    [ "$base" = .trash ] && continue
    [ -f "$candidate" ] && [ ! -L "$candidate" ] || fail "el storage contiene una entrada no regular"
    is_photo_name "$base" || fail "el storage contiene un archivo no permitido"
  done
  for candidate in "$tree_trash"/*; do
    [ -e "$candidate" ] || [ -L "$candidate" ] || continue
    base=$(basename "$candidate")
    printf '%s\n' "$base" | grep -Eq '^[A-Za-z0-9._-]+$' || fail "nombre inseguro en .trash"
    [ -f "$candidate" ] && [ ! -L "$candidate" ] || fail ".trash contiene una entrada no regular"
  done
}

write_manifest() {
  tree=$1
  output=$2
  unsorted="$output.unsorted"
  : > "$unsorted"
  for candidate in "$tree"/pozo-*; do
    [ -e "$candidate" ] || [ -L "$candidate" ] || continue
    base=$(basename "$candidate")
    is_photo_name "$base" || continue
    [ -f "$candidate" ] && [ ! -L "$candidate" ] || fail "manifest encontro una foto no regular"
    size=$(wc -c < "$candidate" | tr -d ' ')
    checksum=$(sha256sum "$candidate" | awk '{print $1}')
    printf 'fotos/%s|%s|%s\n' "$base" "$size" "$checksum" >> "$unsorted"
  done
  for candidate in "$tree/.trash"/*; do
    [ -e "$candidate" ] || [ -L "$candidate" ] || continue
    base=$(basename "$candidate")
    printf '%s\n' "$base" | grep -Eq '^[A-Za-z0-9._-]+$' || fail "manifest encontro un nombre inseguro"
    [ -f "$candidate" ] && [ ! -L "$candidate" ] || fail "manifest encontro trash no regular"
    size=$(wc -c < "$candidate" | tr -d ' ')
    checksum=$(sha256sum "$candidate" | awk '{print $1}')
    printf 'fotos/.trash/%s|%s|%s\n' "$base" "$size" "$checksum" >> "$unsorted"
  done
  LC_ALL=C sort "$unsorted" > "$output"
  rm -f "$unsorted"
}

validate_db_references() {
  tree=$1
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    count=0
    for candidate in "$tree"/pozo-*; do
      [ -f "$candidate" ] || continue
      if printf '%s\n' "$(basename "$candidate")" | grep -Eiq "^pozo-$id\\.(jpg|jpeg|png)$"; then count=$((count + 1)); fi
    done
    [ "$count" -eq 1 ] || {
      [ "$count" -eq 0 ] && fail "DB referencia una foto ausente del snapshot autoritativo"
      fail "el snapshot contiene mas de una foto para un pozo referenciado"
    }
  done < "$refs"
}

count_orphans() {
  tree=$1
  orphans=0
  for candidate in "$tree"/pozo-*; do
    [ -f "$candidate" ] || continue
    id=$(basename "$candidate" | sed -n 's/^pozo-\([1-9][0-9]*\)\..*$/\1/p')
    [ -n "$id" ] || continue
    grep -Fxq "$id" "$refs" || orphans=$((orphans + 1))
  done
}

write_marker() {
  snapshot_hash=$1
  source_kind=$2
  marker_tmp="$root/.rsp-photo-storage-layout.$$.tmp"
  printf 'RSP_PHOTO_STORAGE_LAYOUT=1\nRSP_PHOTO_STORAGE_SNAPSHOT_SHA256=%s\nRSP_PHOTO_STORAGE_SOURCE=%s\n' "$snapshot_hash" "$source_kind" > "$marker_tmp"
  chown 1000:1000 "$marker_tmp"
  chmod 0640 "$marker_tmp"
  mv "$marker_tmp" "$marker"
}

mkdir -p "$root"
[ ! -L "$root" ] || fail "la raiz del volumen no puede ser symlink"
if [ -e "$photos" ] || [ -L "$photos" ]; then [ -d "$photos" ] && [ ! -L "$photos" ] || fail "fotos no es un directorio seguro"; else mkdir "$photos"; fi
if [ -e "$photos/.trash" ] || [ -L "$photos/.trash" ]; then [ -d "$photos/.trash" ] && [ ! -L "$photos/.trash" ] || fail ".trash no es un directorio seguro"; else mkdir "$photos/.trash"; fi
chown 1000:1000 "$photos" "$photos/.trash"
chmod 0750 "$photos" "$photos/.trash"
validate_tree "$photos"

psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT id_pozo FROM public.pozo WHERE foto_url IS NOT NULL ORDER BY id_pozo" > "$refs"
ledger=$(psql --no-psqlrc --tuples-only --no-align --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" --command="SELECT CASE WHEN to_regclass('public.schema_migrations') IS NULL THEN 'absent' ELSE 'present' END")
case "$ledger" in present|absent) :;; *) fail "no se pudo clasificar el ledger";; esac

source_status=${PHOTO_LEGACY_SOURCE_STATUS:-unavailable}
case "$source_status" in
  not_applicable)
    validate_db_references "$photos"
    count_orphans "$photos"
    write_manifest "$photos" "$verified_manifest"
    snapshot_hash=$(sha256sum "$verified_manifest" | awk '{print $1}')
    write_marker "$snapshot_hash" persistent
    references=$(grep -c . "$refs" 2>/dev/null || true)
    echo "PHOTO_STORAGE_READY MODE=existing COPIED=0 UPDATED=0 REMOVED=0 UNCHANGED=0 IDENTICAL=0 ORPHANS=$orphans DB_REFERENCES=$references DB_LEDGER=$ledger SNAPSHOT_SHA256=$snapshot_hash"
    exit 0
    ;;
  available) :;;
  unavailable) fail "el first-upgrade requiere una fuente legacy accesible";;
  *) fail "estado de fuente legacy invalido";;
esac

[ -d "$legacy" ] && [ ! -L "$legacy" ] || fail "la fuente legacy no es un directorio seguro"
if [ -e "$marker" ] || [ -L "$marker" ]; then [ -f "$marker" ] && [ ! -L "$marker" ] || fail "el marker existente no es seguro"; rm -f "$marker"; fi
[ ! -e "$stage_root" ] && [ ! -L "$stage_root" ] || fail "staging ya existe"
mkdir "$stage_root" "$stage_photos" "$stage_photos/.trash"
chown 1000:1000 "$stage_photos" "$stage_photos/.trash"
chmod 0750 "$stage_photos" "$stage_photos/.trash"

for source_file in "$legacy"/pozo-*; do
  [ -e "$source_file" ] || [ -L "$source_file" ] || continue
  base=$(basename "$source_file")
  is_photo_name "$base" || continue
  [ -f "$source_file" ] && [ ! -L "$source_file" ] || fail "la fuente contiene una foto no regular"
  destination_file="$stage_photos/$base"
  cp "$source_file" "$destination_file"
  [ "$(wc -c < "$source_file" | tr -d ' ')" = "$(wc -c < "$destination_file" | tr -d ' ')" ] || fail "la copia staging cambio de tamano"
  [ "$(sha256sum "$source_file" | awk '{print $1}')" = "$(sha256sum "$destination_file" | awk '{print $1}')" ] || fail "la copia staging cambio de checksum"
  chown 1000:1000 "$destination_file"
  chmod 0640 "$destination_file"
  staged=$((staged + 1))
  if [ -n "${PHOTO_STORAGE_TEST_FAIL_AFTER:-}" ] && [ "$staged" -ge "$PHOTO_STORAGE_TEST_FAIL_AFTER" ]; then case "${PHOTO_STORAGE_PROJECT_NAME:-}" in rsp07f-r3-*) fail "fallo de copia staging controlado";; *) fail "inyeccion de fallo no permitida";; esac; fi
done

if [ -e "$legacy/.trash" ] || [ -L "$legacy/.trash" ]; then
  [ -d "$legacy/.trash" ] && [ ! -L "$legacy/.trash" ] || fail "el .trash legacy no es seguro"
  for source_file in "$legacy/.trash"/*; do
    [ -e "$source_file" ] || [ -L "$source_file" ] || continue
    base=$(basename "$source_file")
    printf '%s\n' "$base" | grep -Eq '^[A-Za-z0-9._-]+$' || fail "nombre inseguro en .trash legacy"
    [ -f "$source_file" ] && [ ! -L "$source_file" ] || fail "la fuente contiene trash no regular"
    destination_file="$stage_photos/.trash/$base"
    cp "$source_file" "$destination_file"
    [ "$(sha256sum "$source_file" | awk '{print $1}')" = "$(sha256sum "$destination_file" | awk '{print $1}')" ] || fail "la copia trash cambio de checksum"
    chown 1000:1000 "$destination_file"
    chmod 0640 "$destination_file"
    staged=$((staged + 1))
  done
fi

validate_tree "$stage_photos"
validate_db_references "$stage_photos"
count_orphans "$stage_photos"
write_manifest "$stage_photos" "$source_manifest"
write_manifest "$photos" "$destination_manifest"

while IFS= read -r entry; do
  path=${entry%%|*}
  if grep -Fqx "$entry" "$destination_manifest"; then unchanged=$((unchanged + 1)); elif grep -Fq "$path|" "$destination_manifest"; then updated=$((updated + 1)); else copied=$((copied + 1)); fi
done < "$source_manifest"
while IFS= read -r entry; do path=${entry%%|*}; grep -Fq "$path|" "$source_manifest" || removed=$((removed + 1)); done < "$destination_manifest"

snapshot_hash=$(sha256sum "$source_manifest" | awk '{print $1}')
test_failure staging
sync
[ ! -e "$previous" ] && [ ! -L "$previous" ] || fail "backup de promocion ya existe"
promotion_started=true
mv "$photos" "$previous"
test_failure promotion
mv "$stage_photos" "$photos"
test_failure post_verify
validate_tree "$photos"
validate_db_references "$photos"
write_manifest "$photos" "$verified_manifest"
cmp -s "$source_manifest" "$verified_manifest" || fail "la promocion no coincide con el snapshot"
write_marker "$snapshot_hash" legacy
sync
promotion_complete=true
rm -rf "$previous" "$stage_root"

references=$(grep -c . "$refs" 2>/dev/null || true)
mode=refreshed
[ "$copied" -eq 0 ] && [ "$updated" -eq 0 ] && [ "$removed" -eq 0 ] && mode=existing
[ "$references" -eq 0 ] && [ ! -s "$source_manifest" ] && mode=initialized_empty
trap - EXIT HUP INT TERM
cleanup
echo "PHOTO_STORAGE_READY MODE=$mode COPIED=$copied UPDATED=$updated REMOVED=$removed UNCHANGED=$unchanged IDENTICAL=$unchanged ORPHANS=$orphans DB_REFERENCES=$references DB_LEDGER=$ledger SNAPSHOT_SHA256=$snapshot_hash"
