#!/bin/sh
set -eu
: "${ENV_FILE:?Falta ENV_FILE}";: "${DEPLOYMENT_STATE_FILE:?Falta DEPLOYMENT_STATE_FILE}";: "${PROJECT_NAME:?Falta PROJECT_NAME}"
: "${STATE_FILE:?Falta STATE_FILE}";: "${LEVEL:?Falta LEVEL}";: "${CONFIRM:?Falta CONFIRM}";: "${BACKUP_DIR:?Falta BACKUP_DIR}"
: "${ADMIN_EMAIL:?Falta ADMIN_EMAIL}";: "${ADMIN_PASSWORD_FILE:?Falta ADMIN_PASSWORD_FILE}"
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yaml}
. "$(dirname "$0")/deployment-state.sh";deployment_state_read "$DEPLOYMENT_STATE_FILE";current_hash=$DS_CONFIG_HASH
audit_value(){ awk -F= -v key="$1" '$1==key{print substr($0,length(key)+2);found=1} END{if(!found)exit 1}' "$STATE_FILE"; }
[ "$(audit_value FORMAT)" = 1 ]&&[ "$(audit_value PROJECT)" = "$PROJECT_NAME" ]&&[ "$(audit_value STATUS)" = success ]||{ echo "Audit invalido" >&2;exit 2;}
previous_api=$(audit_value PREVIOUS_API_REF);previous_api_id=$(audit_value PREVIOUS_API_ID);previous_front=$(audit_value PREVIOUS_FRONT_REF);previous_front_id=$(audit_value PREVIOUS_FRONT_ID);previous_version=$(audit_value PREVIOUS_VERSION);previous_sha=$(audit_value PREVIOUS_GIT_SHA);previous_hash=$(audit_value PREVIOUS_CONFIG_HASH);target_hash=$(audit_value TARGET_CONFIG_HASH);bundle=$(audit_value BACKUP_BUNDLE)
case "$LEVEL:$CONFIRM" in
  Application:DATABASE_BACKWARD_COMPATIBLE) [ "$current_hash" = "$target_hash" ];;
  Full:RESTORE_EXISTING_TARGET_FROM_BACKUP) [ "$current_hash" = "$target_hash" ]||[ "$current_hash" = "$previous_hash" ];;
  *) echo "Nivel/confirmacion invalidos" >&2;exit 2;;
esac
[ "$(docker image inspect --format '{{.Id}}' "$previous_api")" = "$previous_api_id" ];[ "$(docker image inspect --format '{{.Id}}' "$previous_front")" = "$previous_front_id" ]
compose(){ docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --env-file "$DEPLOYMENT_STATE_FILE" -f "$COMPOSE_FILE" "$@"; }
rollback_ok=false
on_exit(){ code=$?;if [ "$rollback_ok" != true ];then compose stop proxy >/dev/null 2>&1||true;compose --profile ops up -d --wait --wait-timeout 60 maintenance >/dev/null 2>&1||true;echo ROLLBACK_FAILED;fi;exit "$code";}
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
temp="$STATE_FILE.$$.tmp";sed 's/^STATUS=.*/STATUS=rolled_back/' "$STATE_FILE">"$temp";mv -f "$temp" "$STATE_FILE"
rollback_ok=true;trap - EXIT HUP INT TERM;echo ROLLBACK_OK
