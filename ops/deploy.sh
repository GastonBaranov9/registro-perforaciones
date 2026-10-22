#!/bin/sh
set -eu
: "${ENV_FILE:?Falta ENV_FILE}";: "${DEPLOYMENT_STATE_FILE:?Falta DEPLOYMENT_STATE_FILE}";: "${PROJECT_NAME:?Falta PROJECT_NAME}"
: "${BACKUP_DIR:?Falta BACKUP_DIR}";: "${STATE_DIR:?Falta STATE_DIR}";: "${TARGET_API_IMAGE:?Falta TARGET_API_IMAGE}"
: "${TARGET_FRONT_IMAGE:?Falta TARGET_FRONT_IMAGE}";: "${TARGET_VERSION:?Falta TARGET_VERSION}";: "${TARGET_GIT_SHA:?Falta TARGET_GIT_SHA}"
: "${ADMIN_EMAIL:?Falta ADMIN_EMAIL}";: "${ADMIN_PASSWORD_FILE:?Falta ADMIN_PASSWORD_FILE}"
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yaml};BUILD_IMAGES=${BUILD_IMAGES:-false}
TEST_FAIL_AFTER_PHASE=${TEST_FAIL_AFTER_PHASE:-}
SMOKE_INTERNAL_PORT=${SMOKE_INTERNAL_PORT:-18443};export SMOKE_INTERNAL_PORT
case "$SMOKE_INTERNAL_PORT" in ''|*[!0-9]*) exit 2;;esac
[ "$SMOKE_INTERNAL_PORT" -ge 1 ] && [ "$SMOKE_INTERNAL_PORT" -le 65535 ] || exit 2
smoke_proxy_attempted=false
case "$PROJECT_NAME" in ''|*[!a-z0-9_-]*) echo "ProjectName no es seguro" >&2;exit 2;;esac
if [ -n "$TEST_FAIL_AFTER_PHASE" ];then case "$PROJECT_NAME:$TEST_FAIL_AFTER_PHASE" in rsp07f-r2-*:preflight|rsp07f-r2-*:maintenance|rsp07f-r2-*:backup|rsp07f-r2-*:images|rsp07f-r2-*:migrate|rsp07f-r2-*:services|rsp07f-r2-*:services_incompatible|rsp07f-r2-*:health|rsp07f-r2-*:smoke|rsp07f-r2-*:persist_state|rsp07f-r3-*:preflight|rsp07f-r3-*:maintenance|rsp07f-r3-*:photo_storage|rsp07f-r3-*:backup|rsp07f-r3-*:images|rsp07f-r3-*:migrate|rsp07f-r3-*:services|rsp07f-r3-*:services_incompatible|rsp07f-r3-*:health|rsp07f-r3-*:smoke|rsp07f-r3-*:persist_state) ;;*) echo "Inyeccion de fallo no permitida" >&2;exit 2;;esac;fi
. "$(dirname "$0")/deployment-state.sh"
deployment_state_validate_git_sha "$TARGET_GIT_SHA"
case "$BUILD_IMAGES" in
  true) deployment_state_validate_image "$TARGET_API_IMAGE" "$TARGET_GIT_SHA";deployment_state_validate_image "$TARGET_FRONT_IMAGE" "$TARGET_GIT_SHA" ;;
  false) deployment_state_validate_remote_image "$TARGET_API_IMAGE" "$TARGET_GIT_SHA";deployment_state_validate_remote_image "$TARGET_FRONT_IMAGE" "$TARGET_GIT_SHA" ;;
  *) echo "BUILD_IMAGES invalido" >&2;exit 2 ;;
esac
deployment_state_read "$DEPLOYMENT_STATE_FILE"
unset API_IMAGE_REF FRONT_IMAGE_REF APP_VERSION GIT_SHA
previous_api=$DS_API_IMAGE;previous_front=$DS_FRONT_IMAGE;previous_version=$DS_APP_VERSION;previous_sha=$DS_GIT_SHA;previous_hash=$DS_CONFIG_HASH
target_hash=$(deployment_state_hash "$TARGET_API_IMAGE" "$TARGET_FRONT_IMAGE" "$TARGET_VERSION" "$TARGET_GIT_SHA")
mkdir -p "$BACKUP_DIR" "$STATE_DIR";audit="$STATE_DIR/deploy-$PROJECT_NAME.env";deploy_ok=false;bundle=;previous_api_id=;previous_front_id=;previous_api_container=;previous_proxy_container=;legacy_schema=false;status=started;phase_started=preflight;phase_completed=none;database_recovery=not_required;state_persisted=false;started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
compose(){ docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --env-file "$DEPLOYMENT_STATE_FILE" -f "$COMPOSE_FILE" "$@"; }
compose_smoke(){ docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --env-file "$DEPLOYMENT_STATE_FILE" -f "$COMPOSE_FILE" -f "$(dirname "$0")/smoke-proxy.compose.yaml" "$@"; }
runtime_image(){
  ri_container=$1;ri_reference=$2
  ri_expected=$(docker image inspect --format '{{.Id}}' "$ri_reference") || return 1
  printf '%s\n' "$ri_expected" | grep -Eq '^sha256:[a-f0-9]{64}$' || return 1
  ri_running=$(docker inspect --format '{{.Image}}' "$ri_container") || return 1
  [ "$ri_running" = "$ri_expected" ] || { echo 'Identidad de imagen no coincide con deployment state' >&2;return 1; }
  printf '%s\n' "$ri_running"
}
write_audit(){ temp="$audit.$$.tmp";umask 077;printf 'FORMAT=2\nPROJECT=%s\nSTATUS=%s\nPHASE_STARTED=%s\nPHASE_COMPLETED=%s\nDATABASE_RECOVERY=%s\nLEGACY_SCHEMA_WITHOUT_LEDGER=%s\nSTARTED_AT_UTC=%s\nUPDATED_AT_UTC=%s\nDEPLOYMENT_STATE=%s\nDEPLOYMENT_STATE_PERSISTED=%s\nPREVIOUS_API_REF=%s\nPREVIOUS_API_ID=%s\nPREVIOUS_FRONT_REF=%s\nPREVIOUS_FRONT_ID=%s\nPREVIOUS_VERSION=%s\nPREVIOUS_GIT_SHA=%s\nPREVIOUS_CONFIG_HASH=%s\nTARGET_API_REF=%s\nTARGET_FRONT_REF=%s\nTARGET_VERSION=%s\nTARGET_GIT_SHA=%s\nTARGET_CONFIG_HASH=%s\nBACKUP_BUNDLE=%s\n' "$PROJECT_NAME" "$status" "$phase_started" "$phase_completed" "$database_recovery" "$legacy_schema" "$started_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DEPLOYMENT_STATE_FILE" "$state_persisted" "$previous_api" "$previous_api_id" "$previous_front" "$previous_front_id" "$previous_version" "$previous_sha" "$previous_hash" "$TARGET_API_IMAGE" "$TARGET_FRONT_IMAGE" "$TARGET_VERSION" "$TARGET_GIT_SHA" "$target_hash" "$bundle" > "$temp" || return $?;mv -f "$temp" "$audit"; }
phase_start(){ phase_started=$1;write_audit; }
phase_complete(){ phase_completed=$1;write_audit;if [ "$TEST_FAIL_AFTER_PHASE" = "$1" ];then echo "Fallo controlado RSP-07F-R2 despues de $1" >&2;exit 1;fi; }
# Recovery bypasses Compose/state-file parsing for stopping and inspecting services.
# Each action is independent; diagnostics are held in memory until containment ends.
recovery_error(){ recovery_errors="${recovery_errors}${recovery_errors:+
}$*"; }
recovery_ids(){ docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT_NAME" --filter "label=com.docker.compose.service=$1"; }
recovery_stopped(){
  rs_service=$1
  if rs_ids=$(recovery_ids "$rs_service" 2>&1);then :;else recovery_error "list/$rs_service: $rs_ids";return 1;fi
  for rs_id in $rs_ids;do
    if rs_state=$(docker inspect --format '{{.State.Status}}' "$rs_id" 2>&1);then
      case "$rs_state" in exited|created|dead) ;;*) return 1;;esac
    else recovery_error "verify/$rs_service: $rs_state";return 1;fi
  done
}
recovery_stop(){
  rc_service=$1
  if rc_ids=$(recovery_ids "$rc_service" 2>&1);then :;else recovery_error "list/$rc_service: $rc_ids";return;fi
  for rc_id in $rc_ids;do
    if rc_state=$(docker inspect --format '{{.State.Status}}' "$rc_id" 2>&1);then
      case "$rc_state" in exited|created|dead) continue;;esac
    else recovery_error "inspect/$rc_service: $rc_state";fi
    if rc_output=$(docker stop --time 10 "$rc_id" 2>&1);then :;else
      recovery_error "stop/$rc_service: $rc_output"
      if rc_output=$(docker stop --time 0 "$rc_id" 2>&1);then :;else recovery_error "force-stop/$rc_service: $rc_output";fi
    fi
  done
}
recovery_maintenance(){
  if rm_ids=$(recovery_ids maintenance 2>&1);then :;else recovery_error "list/maintenance: $rm_ids";return 1;fi
  [ -n "$rm_ids" ] || return 1
  for rm_id in $rm_ids;do
    if rm_state=$(docker inspect --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$rm_id" 2>&1);then
      [ "$rm_state" = running/healthy ] || return 1
    else recovery_error "verify/maintenance: $rm_state";return 1;fi
  done
}
on_exit(){
  code=$?;trap - EXIT;set +e
  [ "$deploy_ok" != true ] || exit "$code"
  [ "$code" -ne 0 ] || code=1
  original_phase=$phase_started;recovery_errors=;public_blocked=false;maintenance_verified=false
  recovery_required=true
  case "$phase_started:$database_recovery:$state_persisted" in preflight:not_required:false) recovery_required=false;;esac
  if [ "$recovery_required" = true ];then
    recovery_stop proxy
    if ! recovery_stopped proxy;then recovery_stop api;fi
    if ! recovery_maintenance;then
      if recovery_output=$(compose --profile ops up -d --no-deps --no-recreate --wait --wait-timeout 60 maintenance 2>&1);then :;else recovery_error "start/maintenance: $recovery_output";fi
    fi
    if [ "$smoke_proxy_attempted" = true ];then recovery_stop smoke-proxy;fi
    if recovery_maintenance;then maintenance_verified=true;fi
    if recovery_stopped proxy;then public_blocked=true;else recovery_stop api;fi
  fi
  # A failed audit must not prevent any of the protection attempts above.
  status=failed
  if audit_error=$(write_audit 2>&1);then :;else recovery_error "audit: $audit_error";fi
  printf 'DEPLOY_FAILED\nORIGINAL_EXIT_CODE=%s\nORIGINAL_PHASE=%s\n' "$code" "$original_phase"
  if [ "$recovery_required" = true ];then
    printf 'RECOVERY_PUBLIC_BLOCKED=%s\nRECOVERY_MAINTENANCE_VERIFIED=%s\nROLLBACK_REQUIRED=%s\n' "$public_blocked" "$maintenance_verified" "$audit"
  else printf 'ROLLBACK_NOT_REQUIRED=%s\n' "$audit";fi
  if [ -n "$recovery_errors" ];then printf '%s\n' "$recovery_errors" >&2;fi
  if [ "$recovery_required" = true ] && [ "$public_blocked" != true ];then
    printf '%s\n' 'RECOVERY_CRITICAL: acceso publico no confirmado bloqueado; INTERVENCION MANUAL URGENTE.' >&2
  fi
  exit "$code"
}
trap on_exit EXIT;trap 'exit 130' HUP INT TERM
write_audit
echo "deploy_start target=$TARGET_VERSION config=$target_hash";compose config --quiet
api_id=$(compose ps -q api);front_id=$(compose ps -q front);[ -n "$api_id" ]&&[ -n "$front_id" ]
previous_api_id=$(runtime_image "$api_id" "$previous_api");previous_front_id=$(runtime_image "$front_id" "$previous_front")
running_version=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$api_id"|awk -F= '$1=="APP_VERSION"{print $2;exit}')
[ "$running_version" = "$previous_version" ]||{ echo "Runtime no coincide con deployment state" >&2;exit 1;}
previous_api_container=$api_id;previous_proxy_container=$(compose ps -a -q proxy);[ -n "$previous_proxy_container" ];phase_complete preflight
export API_IMAGE_REF=$TARGET_API_IMAGE FRONT_IMAGE_REF=$TARGET_FRONT_IMAGE APP_VERSION=$TARGET_VERSION GIT_SHA=$TARGET_GIT_SHA
compose config --quiet
case "$BUILD_IMAGES" in true) compose build api front;;false) compose pull api front;;*) echo "BUILD_IMAGES invalido" >&2;exit 2;;esac
database_recovery=operator_assessment_required
phase_start maintenance;compose stop proxy;compose --profile ops up -d --wait --wait-timeout 60 maintenance;compose stop api;phase_complete maintenance
phase_start photo_storage;photo_output=$(ENV_FILE="$ENV_FILE" DEPLOYMENT_STATE_FILE="$DEPLOYMENT_STATE_FILE" PROJECT_NAME="$PROJECT_NAME" COMPOSE_FILE="$COMPOSE_FILE" "$(dirname "$0")/prepare-photo-storage.sh");printf '%s\n' "$photo_output"|grep -q 'PHOTO_STORAGE_READY';ledger=$(printf '%s\n' "$photo_output"|sed -n 's/.* DB_LEDGER=\(present\|absent\).*/\1/p'|tail -1);case "$ledger" in present) legacy_schema=false;;absent) legacy_schema=true;;*) echo "Evidencia de storage inválida" >&2;exit 1;;esac;phase_complete photo_storage
phase_start backup
[ "$(docker inspect --format '{{.State.Running}}' "$api_id")" = false ] || { echo "API no esta detenida" >&2;exit 1; }
backup_output=$(BACKUP_DIR="$BACKUP_DIR" compose --profile ops run --rm backup);bundle=$(printf '%s\n' "$backup_output"|sed -n 's/^BACKUP_BUNDLE=\(rsp-backup-[0-9]\{8\}T[0-9]\{6\}Z\)$/\1/p'|tail -1);[ -n "$bundle" ]||{ echo "Backup invalido" >&2;exit 1;};printf '%s\n' "$backup_output" | grep -Fxq "BACKUP_VERIFIED_FULL=$bundle" || { echo "Falta verificacion del respaldo completo; migraciones bloqueadas" >&2;exit 1; };phase_complete backup
phase_start images
compose config --quiet
phase_complete images;database_recovery=operator_assessment_required;phase_start migrate;if [ "$legacy_schema" = true ];then compose --profile ops run --rm migrate npm run db:migrate -- --adopt-current-schema;else compose --profile ops run --rm migrate;fi;phase_complete migrate
phase_start services;compose up -d --no-deps --wait --wait-timeout 180 api front;smoke_proxy_attempted=true;compose_smoke --profile ops up -d --no-deps --wait --wait-timeout 60 smoke-proxy;phase_complete services
if [ "$TEST_FAIL_AFTER_PHASE" = services_incompatible ];then database_recovery=restore_required;write_audit;echo "Fallo incompatible controlado RSP-07F-R2" >&2;exit 1;fi
phase_start health;phase_complete health;phase_start smoke
smoke=$(SMOKE_CONNECT_PORT="$SMOKE_INTERNAL_PORT" ENV_FILE="$ENV_FILE" DEPLOYMENT_STATE_FILE="$DEPLOYMENT_STATE_FILE" PROJECT_NAME="$PROJECT_NAME" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD_FILE="$ADMIN_PASSWORD_FILE" COMPOSE_FILE="$COMPOSE_FILE" "$(dirname "$0")/smoke.sh");printf '%s\n' "$smoke"|grep -qx SMOKE_OK
phase_complete smoke;phase_start persist_state
deployment_state_write_atomic "$DEPLOYMENT_STATE_FILE" "$TARGET_API_IMAGE" "$TARGET_FRONT_IMAGE" "$TARGET_VERSION" "$TARGET_GIT_SHA"
state_persisted=true;phase_complete persist_state
unset API_IMAGE_REF FRONT_IMAGE_REF APP_VERSION GIT_SHA;deployment_state_read "$DEPLOYMENT_STATE_FILE";[ "$DS_CONFIG_HASH" = "$target_hash" ]
images=$(compose config --images);printf '%s\n' "$images"|grep -Fxq "$TARGET_API_IMAGE";printf '%s\n' "$images"|grep -Fxq "$TARGET_FRONT_IMAGE"
# Critical validation and state persistence have completed under maintenance.
compose_smoke stop smoke-proxy;compose_smoke rm -f smoke-proxy;smoke_proxy_attempted=false
compose stop maintenance;compose rm -f maintenance;compose up -d --no-deps --wait --wait-timeout 180 proxy
public_smoke=$(SMOKE_PUBLIC_ONLY=true ENV_FILE="$ENV_FILE" DEPLOYMENT_STATE_FILE="$DEPLOYMENT_STATE_FILE" PROJECT_NAME="$PROJECT_NAME" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD_FILE="$ADMIN_PASSWORD_FILE" COMPOSE_FILE="$COMPOSE_FILE" "$(dirname "$0")/smoke.sh")
printf '%s\n' "$public_smoke"|grep -qx PUBLIC_SMOKE_OK
phase_start complete;status=success;phase_complete complete;deploy_ok=true;trap - EXIT HUP INT TERM
echo DEPLOY_OK;echo "DEPLOY_AUDIT=$audit";echo "DEPLOYMENT_STATE=$DEPLOYMENT_STATE_FILE"
