#!/bin/sh
set -eu
: "${ENV_FILE:?Falta ENV_FILE}";: "${DEPLOYMENT_STATE_FILE:?Falta DEPLOYMENT_STATE_FILE}";: "${PROJECT_NAME:?Falta PROJECT_NAME}"
: "${STATE_FILE:?Falta STATE_FILE}";: "${LEVEL:?Falta LEVEL}";: "${CONFIRM:?Falta CONFIRM}";: "${BACKUP_DIR:?Falta BACKUP_DIR}"
: "${ADMIN_EMAIL:?Falta ADMIN_EMAIL}";: "${ADMIN_PASSWORD_FILE:?Falta ADMIN_PASSWORD_FILE}"
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yaml}
. "$(dirname "$0")/deployment-state.sh";. "$(dirname "$0")/deployment-audit.sh";deployment_state_read "$DEPLOYMENT_STATE_FILE";current_hash=$DS_CONFIG_HASH;deployment_audit_read "$STATE_FILE" "$PROJECT_NAME" "$DEPLOYMENT_STATE_FILE"
previous_api=$DA_PREVIOUS_API;previous_api_id=$DA_PREVIOUS_API_ID;previous_front=$DA_PREVIOUS_FRONT;previous_front_id=$DA_PREVIOUS_FRONT_ID;previous_version=$DA_PREVIOUS_VERSION;previous_sha=$DA_PREVIOUS_SHA;previous_hash=$DA_PREVIOUS_HASH;target_hash=$DA_TARGET_HASH;bundle=$DA_BUNDLE
case "$LEVEL:$CONFIRM" in
  Application:DATABASE_BACKWARD_COMPATIBLE) ;;
  Full:RESTORE_EXISTING_TARGET_FROM_BACKUP) ;;
  *) echo "Nivel/confirmacion invalidos" >&2;exit 2;;
esac
if [ "$DA_NOOP" = true ];then [ "$current_hash" = "$previous_hash" ]||{ echo "Preflight fallo pero state no conserva N" >&2;exit 1;};temp="$STATE_FILE.$$.tmp";grep -v '^ROLLBACK_' "$STATE_FILE">"$temp";printf 'ROLLBACK_STATUS=not_required\n'>>"$temp";mv -f "$temp" "$STATE_FILE";echo ROLLBACK_NOT_REQUIRED;exit 0;fi
if [ "$DA_REQUIRES_FULL" = true ]&&[ "$LEVEL" != Full ];then echo "Deploy fallido alcanzo migrate; exige Full" >&2;exit 2;fi
if [ "$LEVEL" = Full ]&&[ "$DA_BACKUP_COMPLETED" != true ];then echo "Rollback Full exige backup completado" >&2;exit 2;fi
if [ "$DA_STATUS" = success ]&&[ "$LEVEL" = Application ];then [ "$current_hash" = "$target_hash" ];else [ "$current_hash" = "$target_hash" ]||[ "$current_hash" = "$previous_hash" ];fi
[ "$(docker image inspect --format '{{.Id}}' "$previous_api")" = "$previous_api_id" ];[ "$(docker image inspect --format '{{.Id}}' "$previous_front")" = "$previous_front_id" ]
compose(){ docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --env-file "$DEPLOYMENT_STATE_FILE" -f "$COMPOSE_FILE" "$@"; }
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
rollback_ok=false
on_exit(){
  code=$?;trap - EXIT;set +e
  [ "$rollback_ok" != true ] || exit "$code"
  [ "$code" -ne 0 ] || code=1
  recovery_errors=;public_blocked=false;maintenance_verified=false
  recovery_stop proxy
  if ! recovery_stopped proxy;then recovery_stop api;fi
  if ! recovery_maintenance;then
    if recovery_output=$(compose --profile ops up -d --no-deps --no-recreate --wait --wait-timeout 60 maintenance 2>&1);then :;else recovery_error "start/maintenance: $recovery_output";fi
  fi
  if recovery_maintenance;then maintenance_verified=true;fi
  if recovery_stopped proxy;then public_blocked=true;else recovery_stop api;fi
  # Preserve the original exit status; a failed audit cannot interrupt containment.
  if audit_error=$( {
    temp="$STATE_FILE.$$.tmp"
    { grep -v '^ROLLBACK_' "$STATE_FILE" && printf 'ROLLBACK_STATUS=failed\nROLLBACK_ORIGINAL_EXIT_CODE=%s\nROLLBACK_RECOVERY_PUBLIC_BLOCKED=%s\nROLLBACK_RECOVERY_MAINTENANCE_VERIFIED=%s\n' "$code" "$public_blocked" "$maintenance_verified"; } > "$temp" && mv -f "$temp" "$STATE_FILE"
  } 2>&1);then :;else recovery_error "audit: $audit_error";fi
  printf 'ROLLBACK_FAILED\nORIGINAL_EXIT_CODE=%s\nRECOVERY_PUBLIC_BLOCKED=%s\nRECOVERY_MAINTENANCE_VERIFIED=%s\n' "$code" "$public_blocked" "$maintenance_verified"
  if [ -n "$recovery_errors" ];then printf '%s\n' "$recovery_errors" >&2;fi
  if [ "$public_blocked" != true ];then printf '%s\n' 'RECOVERY_CRITICAL: acceso publico no confirmado bloqueado; INTERVENCION MANUAL URGENTE.' >&2;fi
  exit "$code"
}
trap on_exit EXIT;trap 'exit 130' HUP INT TERM
export API_IMAGE_REF=$previous_api FRONT_IMAGE_REF=$previous_front APP_VERSION=$previous_version GIT_SHA=$previous_sha
echo "rollback_start level=$LEVEL version=$previous_version";compose config --quiet;compose stop proxy;compose --profile ops up -d --wait --wait-timeout 60 maintenance;compose stop api
if [ "$LEVEL" = Full ];then printf '%s' "$bundle"|grep -Eq '^rsp-backup-[0-9]{8}T[0-9]{6}Z$';BACKUP_DIR="$BACKUP_DIR" RESTORE_BUNDLE="$bundle" RESTORE_CONFIRM="$CONFIRM" compose --profile ops run --rm restore;fi
compose up -d --no-deps --force-recreate --wait --wait-timeout 180 api front
compose stop maintenance;compose rm -f maintenance;compose up -d --no-deps --wait --wait-timeout 180 proxy
smoke=$(ENV_FILE="$ENV_FILE" DEPLOYMENT_STATE_FILE="$DEPLOYMENT_STATE_FILE" PROJECT_NAME="$PROJECT_NAME" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD_FILE="$ADMIN_PASSWORD_FILE" COMPOSE_FILE="$COMPOSE_FILE" "$(dirname "$0")/smoke.sh");printf '%s\n' "$smoke"|grep -qx SMOKE_OK
deployment_state_write_atomic "$DEPLOYMENT_STATE_FILE" "$previous_api" "$previous_front" "$previous_version" "$previous_sha"
unset API_IMAGE_REF FRONT_IMAGE_REF APP_VERSION GIT_SHA;deployment_state_read "$DEPLOYMENT_STATE_FILE";[ "$DS_CONFIG_HASH" = "$previous_hash" ]
images=$(compose config --images);printf '%s\n' "$images"|grep -Fxq "$previous_api";printf '%s\n' "$images"|grep -Fxq "$previous_front"
temp="$STATE_FILE.$$.tmp";grep -v '^ROLLBACK_' "$STATE_FILE">"$temp";printf 'ROLLBACK_STATUS=success\nROLLBACK_LEVEL=%s\n' "$LEVEL">>"$temp";mv -f "$temp" "$STATE_FILE"
rollback_ok=true;trap - EXIT HUP INT TERM;echo ROLLBACK_OK
