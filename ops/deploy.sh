#!/bin/sh
set -eu
: "${ENV_FILE:?Falta ENV_FILE}";: "${DEPLOYMENT_STATE_FILE:?Falta DEPLOYMENT_STATE_FILE}";: "${PROJECT_NAME:?Falta PROJECT_NAME}"
: "${BACKUP_DIR:?Falta BACKUP_DIR}";: "${STATE_DIR:?Falta STATE_DIR}";: "${TARGET_API_IMAGE:?Falta TARGET_API_IMAGE}"
: "${TARGET_FRONT_IMAGE:?Falta TARGET_FRONT_IMAGE}";: "${TARGET_VERSION:?Falta TARGET_VERSION}";: "${TARGET_GIT_SHA:?Falta TARGET_GIT_SHA}"
: "${ADMIN_EMAIL:?Falta ADMIN_EMAIL}";: "${ADMIN_PASSWORD_FILE:?Falta ADMIN_PASSWORD_FILE}"
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yaml};BUILD_IMAGES=${BUILD_IMAGES:-false}
case "$PROJECT_NAME" in ''|*[!a-z0-9_-]*) echo "ProjectName no es seguro" >&2;exit 2;;esac
. "$(dirname "$0")/deployment-state.sh";deployment_state_read "$DEPLOYMENT_STATE_FILE"
unset API_IMAGE_REF FRONT_IMAGE_REF APP_VERSION GIT_SHA
previous_api=$DS_API_IMAGE;previous_front=$DS_FRONT_IMAGE;previous_version=$DS_APP_VERSION;previous_sha=$DS_GIT_SHA;previous_hash=$DS_CONFIG_HASH
target_hash=$(deployment_state_hash "$TARGET_API_IMAGE" "$TARGET_FRONT_IMAGE" "$TARGET_VERSION" "$TARGET_GIT_SHA")
mkdir -p "$BACKUP_DIR" "$STATE_DIR";audit="$STATE_DIR/deploy-$PROJECT_NAME.env";deploy_ok=false;bundle=;previous_api_id=;previous_front_id=
compose(){ docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --env-file "$DEPLOYMENT_STATE_FILE" -f "$COMPOSE_FILE" "$@"; }
write_audit(){ temp="$audit.$$.tmp";umask 077;printf 'FORMAT=1\nPROJECT=%s\nSTATUS=%s\nPREVIOUS_API_REF=%s\nPREVIOUS_API_ID=%s\nPREVIOUS_FRONT_REF=%s\nPREVIOUS_FRONT_ID=%s\nPREVIOUS_VERSION=%s\nPREVIOUS_GIT_SHA=%s\nPREVIOUS_CONFIG_HASH=%s\nTARGET_API_REF=%s\nTARGET_FRONT_REF=%s\nTARGET_VERSION=%s\nTARGET_GIT_SHA=%s\nTARGET_CONFIG_HASH=%s\nBACKUP_BUNDLE=%s\n' "$PROJECT_NAME" "$1" "$previous_api" "$previous_api_id" "$previous_front" "$previous_front_id" "$previous_version" "$previous_sha" "$previous_hash" "$TARGET_API_IMAGE" "$TARGET_FRONT_IMAGE" "$TARGET_VERSION" "$TARGET_GIT_SHA" "$target_hash" "$bundle" > "$temp";mv -f "$temp" "$audit"; }
on_exit(){ code=$?;if [ "$deploy_ok" != true ];then write_audit failed||true;compose stop proxy >/dev/null 2>&1||true;compose --profile ops up -d --wait --wait-timeout 60 maintenance >/dev/null 2>&1||true;echo DEPLOY_FAILED;echo "ROLLBACK_REQUIRED=$audit";fi;exit "$code";}
trap on_exit EXIT;trap 'exit 130' HUP INT TERM
echo "deploy_start target=$TARGET_VERSION config=$target_hash";compose config --quiet
api_id=$(compose ps -q api);front_id=$(compose ps -q front);[ -n "$api_id" ]&&[ -n "$front_id" ]
running_api=$(docker inspect --format '{{.Config.Image}}' "$api_id");running_front=$(docker inspect --format '{{.Config.Image}}' "$front_id");running_version=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$api_id"|awk -F= '$1=="APP_VERSION"{print $2;exit}')
[ "$running_api" = "$previous_api" ]&&[ "$running_front" = "$previous_front" ]&&[ "$running_version" = "$previous_version" ]||{ echo "Runtime no coincide con deployment state" >&2;exit 1;}
previous_api_id=$(docker inspect --format '{{.Image}}' "$api_id");previous_front_id=$(docker inspect --format '{{.Image}}' "$front_id");write_audit started
compose stop proxy;compose --profile ops up -d --wait --wait-timeout 60 maintenance;compose stop api
backup_output=$(BACKUP_DIR="$BACKUP_DIR" compose --profile ops run --rm backup);bundle=$(printf '%s\n' "$backup_output"|sed -n 's/^BACKUP_BUNDLE=\(rsp-backup-[0-9]\{8\}T[0-9]\{6\}Z\)$/\1/p'|tail -1);[ -n "$bundle" ]||{ echo "Backup invalido" >&2;exit 1;};write_audit started
export API_IMAGE_REF=$TARGET_API_IMAGE FRONT_IMAGE_REF=$TARGET_FRONT_IMAGE APP_VERSION=$TARGET_VERSION GIT_SHA=$TARGET_GIT_SHA
compose config --quiet
case "$BUILD_IMAGES" in true) compose build api front;;false) compose pull api front;;*) echo "BUILD_IMAGES invalido" >&2;exit 2;;esac
compose --profile ops run --rm migrate;compose up -d --no-deps --wait --wait-timeout 180 api front
compose stop maintenance;compose rm -f maintenance;compose up -d --no-deps --wait --wait-timeout 180 proxy
smoke=$(ENV_FILE="$ENV_FILE" DEPLOYMENT_STATE_FILE="$DEPLOYMENT_STATE_FILE" PROJECT_NAME="$PROJECT_NAME" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD_FILE="$ADMIN_PASSWORD_FILE" COMPOSE_FILE="$COMPOSE_FILE" "$(dirname "$0")/smoke.sh");printf '%s\n' "$smoke"|grep -qx SMOKE_OK
deployment_state_write_atomic "$DEPLOYMENT_STATE_FILE" "$TARGET_API_IMAGE" "$TARGET_FRONT_IMAGE" "$TARGET_VERSION" "$TARGET_GIT_SHA"
unset API_IMAGE_REF FRONT_IMAGE_REF APP_VERSION GIT_SHA;deployment_state_read "$DEPLOYMENT_STATE_FILE";[ "$DS_CONFIG_HASH" = "$target_hash" ]
images=$(compose config --images);printf '%s\n' "$images"|grep -Fxq "$TARGET_API_IMAGE";printf '%s\n' "$images"|grep -Fxq "$TARGET_FRONT_IMAGE"
write_audit success;deploy_ok=true;trap - EXIT HUP INT TERM
echo DEPLOY_OK;echo "DEPLOY_AUDIT=$audit";echo "DEPLOYMENT_STATE=$DEPLOYMENT_STATE_FILE"
