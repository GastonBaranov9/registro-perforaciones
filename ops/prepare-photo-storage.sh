#!/bin/sh
set -eu
: "${ENV_FILE:?Falta ENV_FILE}"
: "${DEPLOYMENT_STATE_FILE:?Falta DEPLOYMENT_STATE_FILE}"
: "${PROJECT_NAME:?Falta PROJECT_NAME}"
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yaml}
case "$PROJECT_NAME" in ''|*[!a-z0-9_-]*) echo "ProjectName no es seguro" >&2;exit 2;;esac
if [ -n "${PHOTO_STORAGE_TEST_FAIL_AFTER:-}${PHOTO_STORAGE_TEST_FAIL_AT:-}" ];then case "$PROJECT_NAME" in rsp07f-r3-*) :;;*) echo "Inyección de fallo no permitida" >&2;exit 2;;esac;fi
temp_root=$(mktemp -d "${TMPDIR:-/tmp}/rsp-photo-import.XXXXXX")
legacy="$temp_root/legacy";mkdir "$legacy"
cleanup(){ rm -rf "$temp_root"; }
trap cleanup EXIT HUP INT TERM
compose(){ docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --env-file "$DEPLOYMENT_STATE_FILE" -f "$COMPOSE_FILE" "$@"; }
api_id=$(compose ps -a -q api);[ -n "$api_id" ]||{ echo "No se encontró el container API previo" >&2;exit 1;}
[ "$(docker inspect --format '{{.State.Running}}' "$api_id")" = false ]||{ echo "El API previo debe estar detenido antes de capturar fotos" >&2;exit 1;}
source_status=not_applicable
if ! docker inspect --format '{{range .Mounts}}{{println .Destination}}{{end}}' "$api_id" | grep -Fxq /var/lib/registro-perforaciones;then
  docker cp "$api_id:/api/public/." "$legacy" 2>/dev/null || {
    echo "El filesystem de fotos del API legacy no pudo exportarse; no es seguro continuar" >&2
    exit 1
  }
  source_status=available
fi
export PHOTO_STORAGE_IMPORT_DIR="$legacy" PHOTO_LEGACY_SOURCE_STATUS="$source_status" PHOTO_STORAGE_PROJECT_NAME="$PROJECT_NAME"
compose --profile ops run --rm prepare-photo-storage
