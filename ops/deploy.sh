#!/bin/sh
set -eu
: "${ENV_FILE:?Falta ENV_FILE}";: "${DEPLOYMENT_STATE_FILE:?Falta DEPLOYMENT_STATE_FILE}";: "${PROJECT_NAME:?Falta PROJECT_NAME}"
: "${BACKUP_DIR:?Falta BACKUP_DIR}";: "${STATE_DIR:?Falta STATE_DIR}";: "${TARGET_API_IMAGE:?Falta TARGET_API_IMAGE}"
: "${TARGET_FRONT_IMAGE:?Falta TARGET_FRONT_IMAGE}";: "${TARGET_VERSION:?Falta TARGET_VERSION}";: "${TARGET_GIT_SHA:?Falta TARGET_GIT_SHA}"
: "${ADMIN_EMAIL:?Falta ADMIN_EMAIL}";: "${ADMIN_PASSWORD_FILE:?Falta ADMIN_PASSWORD_FILE}"
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yaml};BUILD_IMAGES=${BUILD_IMAGES:-false}
TEST_FAIL_AFTER_PHASE=${TEST_FAIL_AFTER_PHASE:-}
case "$PROJECT_NAME" in ''|*[!a-z0-9_-]*) echo "ProjectName no es seguro" >&2;exit 2;;esac
if [ -n "$TEST_FAIL_AFTER_PHASE" ];then case "$PROJECT_NAME:$TEST_FAIL_AFTER_PHASE" in rsp07f-r2-*:preflight|rsp07f-r2-*:maintenance|rsp07f-r2-*:backup|rsp07f-r2-*:images|rsp07f-r2-*:migrate|rsp07f-r2-*:services|rsp07f-r2-*:services_incompatible|rsp07f-r2-*:health|rsp07f-r2-*:smoke|rsp07f-r2-*:persist_state) ;;*) echo "Inyeccion de fallo no permitida" >&2;exit 2;;esac;fi
. "$(dirname "$0")/deployment-state.sh";deployment_state_read "$DEPLOYMENT_STATE_FILE"
unset API_IMAGE_REF FRONT_IMAGE_REF APP_VERSION GIT_SHA
previous_api=$DS_API_IMAGE;previous_front=$DS_FRONT_IMAGE;previous_version=$DS_APP_VERSION;previous_sha=$DS_GIT_SHA;previous_hash=$DS_CONFIG_HASH
target_hash=$(deployment_state_hash "$TARGET_API_IMAGE" "$TARGET_FRONT_IMAGE" "$TARGET_VERSION" "$TARGET_GIT_SHA")
mkdir -p "$BACKUP_DIR" "$STATE_DIR";audit="$STATE_DIR/deploy-$PROJECT_NAME.env";deploy_ok=false;bundle=;previous_api_id=;previous_front_id=;status=started;phase_started=preflight;phase_completed=none;database_recovery=not_required;state_persisted=false;started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
compose(){ docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --env-file "$DEPLOYMENT_STATE_FILE" -f "$COMPOSE_FILE" "$@"; }
write_audit(){ temp="$audit.$$.tmp";umask 077;printf 'FORMAT=2\nPROJECT=%s\nSTATUS=%s\nPHASE_STARTED=%s\nPHASE_COMPLETED=%s\nDATABASE_RECOVERY=%s\nSTARTED_AT_UTC=%s\nUPDATED_AT_UTC=%s\nDEPLOYMENT_STATE=%s\nDEPLOYMENT_STATE_PERSISTED=%s\nPREVIOUS_API_REF=%s\nPREVIOUS_API_ID=%s\nPREVIOUS_FRONT_REF=%s\nPREVIOUS_FRONT_ID=%s\nPREVIOUS_VERSION=%s\nPREVIOUS_GIT_SHA=%s\nPREVIOUS_CONFIG_HASH=%s\nTARGET_API_REF=%s\nTARGET_FRONT_REF=%s\nTARGET_VERSION=%s\nTARGET_GIT_SHA=%s\nTARGET_CONFIG_HASH=%s\nBACKUP_BUNDLE=%s\n' "$PROJECT_NAME" "$status" "$phase_started" "$phase_completed" "$database_recovery" "$started_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DEPLOYMENT_STATE_FILE" "$state_persisted" "$previous_api" "$previous_api_id" "$previous_front" "$previous_front_id" "$previous_version" "$previous_sha" "$previous_hash" "$TARGET_API_IMAGE" "$TARGET_FRONT_IMAGE" "$TARGET_VERSION" "$TARGET_GIT_SHA" "$target_hash" "$bundle" > "$temp";mv -f "$temp" "$audit"; }
phase_start(){ phase_started=$1;write_audit; }
phase_complete(){ phase_completed=$1;write_audit;if [ "$TEST_FAIL_AFTER_PHASE" = "$1" ];then echo "Fallo controlado RSP-07F-R2 despues de $1" >&2;exit 1;fi; }
on_exit(){ code=$?;if [ "$deploy_ok" != true ];then status=failed;write_audit||true;if [ "$phase_started" != preflight ];then compose stop proxy >/dev/null 2>&1||true;compose --profile ops up -d --wait --wait-timeout 60 maintenance >/dev/null 2>&1||true;fi;echo DEPLOY_FAILED;if [ "$phase_started" = preflight ];then echo "ROLLBACK_NOT_REQUIRED=$audit";else echo "ROLLBACK_REQUIRED=$audit";fi;fi;exit "$code";}
trap on_exit EXIT;trap 'exit 130' HUP INT TERM
write_audit
echo "deploy_start target=$TARGET_VERSION config=$target_hash";compose config --quiet
api_id=$(compose ps -q api);front_id=$(compose ps -q front);[ -n "$api_id" ]&&[ -n "$front_id" ]
running_api=$(docker inspect --format '{{.Config.Image}}' "$api_id");running_front=$(docker inspect --format '{{.Config.Image}}' "$front_id");running_version=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$api_id"|awk -F= '$1=="APP_VERSION"{print $2;exit}')
[ "$running_api" = "$previous_api" ]&&[ "$running_front" = "$previous_front" ]&&[ "$running_version" = "$previous_version" ]||{ echo "Runtime no coincide con deployment state" >&2;exit 1;}
previous_api_id=$(docker inspect --format '{{.Image}}' "$api_id");previous_front_id=$(docker inspect --format '{{.Image}}' "$front_id");phase_complete preflight
phase_start maintenance;compose stop proxy;compose --profile ops up -d --wait --wait-timeout 60 maintenance;compose stop api;phase_complete maintenance
phase_start backup;backup_output=$(BACKUP_DIR="$BACKUP_DIR" compose --profile ops run --rm backup);bundle=$(printf '%s\n' "$backup_output"|sed -n 's/^BACKUP_BUNDLE=\(rsp-backup-[0-9]\{8\}T[0-9]\{6\}Z\)$/\1/p'|tail -1);[ -n "$bundle" ]||{ echo "Backup invalido" >&2;exit 1;};phase_complete backup
export API_IMAGE_REF=$TARGET_API_IMAGE FRONT_IMAGE_REF=$TARGET_FRONT_IMAGE APP_VERSION=$TARGET_VERSION GIT_SHA=$TARGET_GIT_SHA
phase_start images
compose config --quiet
case "$BUILD_IMAGES" in true) compose build api front;;false) compose pull api front;;*) echo "BUILD_IMAGES invalido" >&2;exit 2;;esac
phase_complete images;database_recovery=operator_assessment_required;phase_start migrate;compose --profile ops run --rm migrate;phase_complete migrate
phase_start services;compose up -d --no-deps --wait --wait-timeout 180 api front;compose stop maintenance;compose rm -f maintenance;compose up -d --no-deps --wait --wait-timeout 180 proxy;phase_complete services
if [ "$TEST_FAIL_AFTER_PHASE" = services_incompatible ];then database_recovery=restore_required;write_audit;echo "Fallo incompatible controlado RSP-07F-R2" >&2;exit 1;fi
phase_start health;phase_complete health;phase_start smoke
smoke=$(ENV_FILE="$ENV_FILE" DEPLOYMENT_STATE_FILE="$DEPLOYMENT_STATE_FILE" PROJECT_NAME="$PROJECT_NAME" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD_FILE="$ADMIN_PASSWORD_FILE" COMPOSE_FILE="$COMPOSE_FILE" "$(dirname "$0")/smoke.sh");printf '%s\n' "$smoke"|grep -qx SMOKE_OK
phase_complete smoke;phase_start persist_state
deployment_state_write_atomic "$DEPLOYMENT_STATE_FILE" "$TARGET_API_IMAGE" "$TARGET_FRONT_IMAGE" "$TARGET_VERSION" "$TARGET_GIT_SHA"
state_persisted=true;phase_complete persist_state
unset API_IMAGE_REF FRONT_IMAGE_REF APP_VERSION GIT_SHA;deployment_state_read "$DEPLOYMENT_STATE_FILE";[ "$DS_CONFIG_HASH" = "$target_hash" ]
images=$(compose config --images);printf '%s\n' "$images"|grep -Fxq "$TARGET_API_IMAGE";printf '%s\n' "$images"|grep -Fxq "$TARGET_FRONT_IMAGE"
phase_start complete;status=success;phase_complete complete;deploy_ok=true;trap - EXIT HUP INT TERM
echo DEPLOY_OK;echo "DEPLOY_AUDIT=$audit";echo "DEPLOYMENT_STATE=$DEPLOYMENT_STATE_FILE"
