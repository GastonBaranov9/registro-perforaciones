#!/bin/sh
set -eu

deployment_audit_phase_rank(){
  case "$1" in none) echo 0;;preflight) echo 1;;maintenance) echo 2;;photo_storage) echo 3;;backup) echo 4;;images) echo 5;;migrate) echo 6;;services) echo 7;;health) echo 8;;smoke) echo 9;;persist_state) echo 10;;complete) echo 11;;*) return 1;;esac
}

deployment_audit_value(){
  awk -F= -v key="$2" '$1==key{count++;value=substr($0,length(key)+2)} END{if(count!=1)exit 1;print value}' "$1"
}

deployment_audit_read(){
  file=$1;expected_project=$2;expected_state=$3
  [ -f "$file" ] || { echo "Audit inexistente" >&2;return 1; }
  DA_FORMAT=$(deployment_audit_value "$file" FORMAT);DA_PROJECT=$(deployment_audit_value "$file" PROJECT);DA_STATUS=$(deployment_audit_value "$file" STATUS)
  DA_PHASE_STARTED=$(deployment_audit_value "$file" PHASE_STARTED);DA_PHASE_COMPLETED=$(deployment_audit_value "$file" PHASE_COMPLETED);DA_DATABASE_RECOVERY=$(deployment_audit_value "$file" DATABASE_RECOVERY);DA_STARTED_AT=$(deployment_audit_value "$file" STARTED_AT_UTC);DA_UPDATED_AT=$(deployment_audit_value "$file" UPDATED_AT_UTC);DA_DEPLOYMENT_STATE=$(deployment_audit_value "$file" DEPLOYMENT_STATE);DA_STATE_PERSISTED=$(deployment_audit_value "$file" DEPLOYMENT_STATE_PERSISTED)
  DA_PREVIOUS_API=$(deployment_audit_value "$file" PREVIOUS_API_REF);DA_PREVIOUS_API_ID=$(deployment_audit_value "$file" PREVIOUS_API_ID);DA_PREVIOUS_FRONT=$(deployment_audit_value "$file" PREVIOUS_FRONT_REF);DA_PREVIOUS_FRONT_ID=$(deployment_audit_value "$file" PREVIOUS_FRONT_ID);DA_PREVIOUS_VERSION=$(deployment_audit_value "$file" PREVIOUS_VERSION);DA_PREVIOUS_SHA=$(deployment_audit_value "$file" PREVIOUS_GIT_SHA);DA_PREVIOUS_HASH=$(deployment_audit_value "$file" PREVIOUS_CONFIG_HASH)
  DA_TARGET_API=$(deployment_audit_value "$file" TARGET_API_REF);DA_TARGET_FRONT=$(deployment_audit_value "$file" TARGET_FRONT_REF);DA_TARGET_VERSION=$(deployment_audit_value "$file" TARGET_VERSION);DA_TARGET_SHA=$(deployment_audit_value "$file" TARGET_GIT_SHA);DA_TARGET_HASH=$(deployment_audit_value "$file" TARGET_CONFIG_HASH);DA_BUNDLE=$(deployment_audit_value "$file" BACKUP_BUNDLE)
  [ "$DA_FORMAT" = 2 ]&&[ "$DA_PROJECT" = "$expected_project" ]&&[ "$DA_DEPLOYMENT_STATE" = "$expected_state" ]||{ echo "Audit no corresponde a formato/proyecto/state" >&2;return 1; }
  case "$DA_STATUS" in started|failed|success) ;;*) echo "Estado de audit desconocido" >&2;return 1;;esac
  case "$DA_DATABASE_RECOVERY" in not_required|operator_assessment_required|restore_required) ;;*) echo "Clasificacion DB desconocida" >&2;return 1;;esac
  sr=$(deployment_audit_phase_rank "$DA_PHASE_STARTED")||{ echo "Fase iniciada desconocida" >&2;return 1;};cr=$(deployment_audit_phase_rank "$DA_PHASE_COMPLETED")||{ echo "Fase completada desconocida" >&2;return 1;};[ "$cr" -le "$sr" ]||return 1
  printf '%s' "$DA_STARTED_AT"|grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'||{ echo "Timestamp de audit invalido" >&2;return 1; }
  printf '%s' "$DA_UPDATED_AT"|grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'||{ echo "Timestamp de audit invalido" >&2;return 1; }
  deployment_state_validate_image "$DA_PREVIOUS_API";deployment_state_validate_image "$DA_PREVIOUS_FRONT";deployment_state_validate_image "$DA_TARGET_API";deployment_state_validate_image "$DA_TARGET_FRONT"
  deployment_state_validate_identifier "$DA_PREVIOUS_VERSION";deployment_state_validate_identifier "$DA_PREVIOUS_SHA";deployment_state_validate_identifier "$DA_TARGET_VERSION";deployment_state_validate_identifier "$DA_TARGET_SHA"
  printf '%s' "$DA_PREVIOUS_API_ID"|grep -Eq '^sha256:[a-f0-9]{64}$'||{ echo "Image ID previo invalido" >&2;return 1; }
  printf '%s' "$DA_PREVIOUS_FRONT_ID"|grep -Eq '^sha256:[a-f0-9]{64}$'||{ echo "Image ID previo invalido" >&2;return 1; }
  [ "$DA_PREVIOUS_HASH" = "$(deployment_state_hash "$DA_PREVIOUS_API" "$DA_PREVIOUS_FRONT" "$DA_PREVIOUS_VERSION" "$DA_PREVIOUS_SHA")" ]&&[ "$DA_TARGET_HASH" = "$(deployment_state_hash "$DA_TARGET_API" "$DA_TARGET_FRONT" "$DA_TARGET_VERSION" "$DA_TARGET_SHA")" ]||{ echo "Checksum de config corrupto" >&2;return 1; }
  case "$DA_STATE_PERSISTED" in true|false) ;;*) return 1;;esac
  DA_BACKUP_COMPLETED=false;[ "$cr" -lt 4 ]||DA_BACKUP_COMPLETED=true
  if [ "$DA_BACKUP_COMPLETED" = true ];then printf '%s' "$DA_BUNDLE"|grep -Eq '^rsp-backup-[0-9]{8}T[0-9]{6}Z$'||{ echo "Bundle faltante" >&2;return 1;};fi
  DA_NOOP=false;DA_REQUIRES_FULL=false
  if [ "$DA_STATUS" != success ]&&[ "$DA_DATABASE_RECOVERY" = not_required ]&&[ "$DA_STATE_PERSISTED" = false ]&&[ "$sr" -le 5 ];then DA_NOOP=true;fi
  if [ "$DA_DATABASE_RECOVERY" = restore_required ];then DA_REQUIRES_FULL=true;fi
}
