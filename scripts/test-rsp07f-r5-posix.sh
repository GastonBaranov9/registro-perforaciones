#!/bin/sh
set -eu

repo=${1:?Falta repo}
case "$repo" in /*|[A-Za-z]:/*) ;;*) echo "Repo no absoluto" >&2;exit 2;;esac
repo_physical=$(CDPATH= cd -- "$repo"&&pwd)

temp_root=$(CDPATH= cd -- "${TMPDIR:-/tmp}"&&pwd)
temp=$(mktemp -d "$temp_root/rsp07f-r5-posix-XXXXXX")
fixture="$temp/fixture with spaces"
external="$temp/external cwd"
fakebin="$temp/fake bin"
cleanup(){
  case "$temp" in "$temp_root"/rsp07f-r5-posix-??????) rm -rf -- "$temp";;*) echo "Temporal R5 inseguro: $temp" >&2;;esac
}
trap cleanup EXIT HUP INT TERM
mkdir -p "$fixture/scripts" "$fixture/ops" "$external" "$fakebin"

. "$repo/ops/deployment-state.sh"
. "$repo/ops/deployment-audit.sh"

state="$temp/deployment.env"
audit="$temp/audit.env"
env_file="$temp/production.env"
password_file="$temp/admin-password"
backup_dir="$temp/backups"
state_dir="$temp/audits"
mkdir -p "$backup_dir" "$state_dir"
: > "$env_file"
printf '%s' fixture-only > "$password_file"

api_n=example/api:n
front_n=example/front:n
api_n1=example/api:n1
front_n1=example/front:n1
sha_n=abc123
sha_n1=def456
id_api=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
id_front=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
bundle=rsp-backup-20260818T120000Z
previous_hash=$(deployment_state_hash "$api_n" "$front_n" n "$sha_n")
target_hash=$(deployment_state_hash "$api_n1" "$front_n1" n1 "$sha_n1")
deployment_state_write_atomic "$state" "$api_n" "$front_n" n "$sha_n" >/dev/null

write_audit(){
  status=$1;started=$2;completed=$3;recovery=$4;api_id=$5;front_id=$6;audit_bundle=$7
  persisted=false;[ "$completed" != complete ]||persisted=true
  printf 'FORMAT=2\nPROJECT=rsp07f-r5-posix\nSTATUS=%s\nPHASE_STARTED=%s\nPHASE_COMPLETED=%s\nDATABASE_RECOVERY=%s\nLEGACY_SCHEMA_WITHOUT_LEDGER=false\nSTARTED_AT_UTC=2026-08-18T12:00:00Z\nUPDATED_AT_UTC=2026-08-18T12:01:00Z\nDEPLOYMENT_STATE=%s\nDEPLOYMENT_STATE_PERSISTED=%s\nPREVIOUS_API_REF=%s\nPREVIOUS_API_ID=%s\nPREVIOUS_FRONT_REF=%s\nPREVIOUS_FRONT_ID=%s\nPREVIOUS_VERSION=n\nPREVIOUS_GIT_SHA=%s\nPREVIOUS_CONFIG_HASH=%s\nTARGET_API_REF=%s\nTARGET_FRONT_REF=%s\nTARGET_VERSION=n1\nTARGET_GIT_SHA=%s\nTARGET_CONFIG_HASH=%s\nBACKUP_BUNDLE=%s\n' \
    "$status" "$started" "$completed" "$recovery" "$state" "$persisted" "$api_n" "$api_id" "$front_n" "$front_id" "$sha_n" "$previous_hash" "$api_n1" "$front_n1" "$sha_n1" "$target_hash" "$audit_bundle" > "$audit"
}

expect_rejected(){
  name=$1
  if deployment_audit_read "$audit" rsp07f-r5-posix "$state" >/dev/null 2>&1;then
    echo "No se rechazo $name" >&2
    exit 1
  fi
}

write_audit failed preflight none not_required '' '' ''
deployment_audit_read "$audit" rsp07f-r5-posix "$state"
[ "$DA_NOOP" = true ]&&[ "$DA_REQUIRES_FULL" = false ]&&[ "$DA_BACKUP_COMPLETED" = false ]

write_audit failed alien none not_required '' '' ''
expect_rejected fase-desconocida

write_audit failed services services operator_assessment_required '' '' "$bundle"
expect_rejected rollback-app-sin-ids

write_audit failed services services operator_assessment_required "$id_api" "$id_front" "$bundle"
deployment_audit_read "$audit" rsp07f-r5-posix "$state"
[ "$DA_NOOP" = false ]&&[ "$DA_REQUIRES_FULL" = false ]&&[ "$DA_BACKUP_COMPLETED" = true ]

write_audit failed services services restore_required "$id_api" "$id_front" ''
expect_rejected restore-sin-backup

write_audit failed services services restore_required "$id_api" "$id_front" "$bundle"
deployment_audit_read "$audit" rsp07f-r5-posix "$state"
[ "$DA_REQUIRES_FULL" = true ]&&[ "$DA_BACKUP_COMPLETED" = true ]

write_audit success complete complete operator_assessment_required "$id_api" "$id_front" "$bundle"
deployment_audit_read "$audit" rsp07f-r5-posix "$state"
[ "$DA_NOOP" = false ]&&[ "$DA_REQUIRES_FULL" = false ]

write_audit failed preflight none not_required '' '' ''
sed 's|PREVIOUS_API_REF=example/api:n|PREVIOUS_API_REF=|' "$audit" > "$audit.invalid"
mv "$audit.invalid" "$audit"
expect_rejected noop-incompleto

docker_marker="$temp/docker-called"
cat > "$fakebin/docker" <<'EOF'
#!/bin/sh
: > "${RSP_R5_DOCKER_MARKER:?}"
if [ "${1:-}" = image ]&&[ "${2:-}" = inspect ];then
  case "$*" in *example/api:n) printf '%s\n' sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;;*) printf '%s\n' sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;;esac
fi
exit 0
EOF
chmod +x "$fakebin/docker"

write_audit failed preflight none not_required '' '' ''
rollback_output=$(PATH="$fakebin:$PATH" RSP_R5_DOCKER_MARKER="$docker_marker" ENV_FILE="$env_file" DEPLOYMENT_STATE_FILE="$state" PROJECT_NAME=rsp07f-r5-posix STATE_FILE="$audit" LEVEL=Application CONFIRM=DATABASE_BACKWARD_COMPATIBLE BACKUP_DIR="$backup_dir" ADMIN_EMAIL=fixture@example.test ADMIN_PASSWORD_FILE="$password_file" "$repo/ops/rollback.sh")
[ "$rollback_output" = ROLLBACK_NOT_REQUIRED ]
[ ! -e "$docker_marker" ]

launcher_log="$temp/launcher-docker.log"
cat > "$fakebin/docker" <<'EOF'
#!/bin/sh
printf '%s|%s\n' "$PWD" "$*" >> "${RSP_R5_LAUNCHER_LOG:?}"
exit 23
EOF
chmod +x "$fakebin/docker"

run_launcher(){
  caller=$1;label=$2
  run_state_dir="$state_dir/$label"
  mkdir -p "$run_state_dir"
  : > "$launcher_log"
  set +e
  (cd "$caller"&&PATH="$fakebin:$PATH" RSP_R5_LAUNCHER_LOG="$launcher_log" ENV_FILE="$env_file" DEPLOYMENT_STATE_FILE="$state" PROJECT_NAME="rsp07f-r5-$label" BACKUP_DIR="$backup_dir" STATE_DIR="$run_state_dir" TARGET_API_IMAGE="$api_n1" TARGET_FRONT_IMAGE="$front_n1" TARGET_VERSION=n1 TARGET_GIT_SHA="$sha_n1" ADMIN_EMAIL=fixture@example.test ADMIN_PASSWORD_FILE="$password_file" "$repo/scripts/deploy.sh" "--probe-$label" "value with spaces") > "$temp/launcher-$label.out" 2>&1
  code=$?
  set -e
  [ "$code" -ne 0 ]
  grep -Fq "$repo_physical|compose " "$launcher_log"
  grep -Fq ' -f docker-compose.production.yaml config --quiet' "$launcher_log"
  grep -Fq 'ROLLBACK_NOT_REQUIRED=' "$temp/launcher-$label.out"
}

run_launcher "$repo" root
run_launcher "$repo/ops" subdir
run_launcher "$external" external

cp "$repo/scripts/deploy.sh" "$fixture/scripts/deploy.sh"
: > "$fixture/docker-compose.production.yaml"
cat > "$fixture/ops/deploy.sh" <<'EOF'
#!/bin/sh
printf 'PWD=%s\n' "$PWD"
for arg do printf 'ARG=%s\n' "$arg";done
EOF
chmod +x "$fixture/ops/deploy.sh" "$fixture/scripts/deploy.sh"
(cd "$external"&&"$fixture/scripts/deploy.sh" plain 'value with spaces' '*' 'semi;colon' --env-file '/tmp/path with spaces') > "$temp/args.out"
grep -Fqx "PWD=$fixture" "$temp/args.out"
grep -Fqx 'ARG=plain' "$temp/args.out"
grep -Fqx 'ARG=value with spaces' "$temp/args.out"
grep -Fqx 'ARG=*' "$temp/args.out"
grep -Fqx 'ARG=semi;colon' "$temp/args.out"
grep -Fqx 'ARG=--env-file' "$temp/args.out"
grep -Fqx 'ARG=/tmp/path with spaces' "$temp/args.out"
[ "$(grep -c '^ARG=' "$temp/args.out")" -eq 6 ]

missing_config="$temp/missing config"
mkdir -p "$missing_config/scripts" "$missing_config/ops"
cp "$repo/scripts/deploy.sh" "$missing_config/scripts/deploy.sh"
cp "$fixture/ops/deploy.sh" "$missing_config/ops/deploy.sh"
set +e
"$missing_config/scripts/deploy.sh" > "$temp/missing-config.out" 2>&1
missing_code=$?
set -e
[ "$missing_code" -ne 0 ]
grep -Fq 'deploy launcher: no existe ' "$temp/missing-config.out"
grep -Fq 'docker-compose.production.yaml' "$temp/missing-config.out"

missing_deploy="$temp/missing deploy"
mkdir -p "$missing_deploy/scripts" "$missing_deploy/ops"
cp "$repo/scripts/deploy.sh" "$missing_deploy/scripts/deploy.sh"
: > "$missing_deploy/docker-compose.production.yaml"
set +e
"$missing_deploy/scripts/deploy.sh" > "$temp/missing-deploy.out" 2>&1
missing_code=$?
set -e
[ "$missing_code" -ne 0 ]
grep -Fq 'deploy launcher: no existe ' "$temp/missing-deploy.out"
grep -Fq 'ops/deploy.sh' "$temp/missing-deploy.out"

rollback_fixture="$temp/rollback fixture"
mkdir -p "$rollback_fixture/ops"
cp "$repo/ops/rollback.sh" "$repo/ops/deployment-state.sh" "$repo/ops/deployment-audit.sh" "$rollback_fixture/ops/"
: > "$rollback_fixture/docker-compose.production.yaml"
cat > "$rollback_fixture/ops/smoke.sh" <<'EOF'
#!/bin/sh
echo SMOKE_OK
EOF
chmod +x "$rollback_fixture/ops/"*.sh
cat > "$fakebin/docker" <<'EOF'
#!/bin/sh
: > "${RSP_R5_DOCKER_MARKER:?}"
if [ "${1:-}" = image ]&&[ "${2:-}" = inspect ];then
  case "$*" in *example/api:n) printf '%s\n' sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;;*) printf '%s\n' sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;;esac
elif [ "${1:-}" = compose ];then
  case "$*" in *' config --images') printf '%s\n' example/api:n example/front:n;;esac
fi
exit 0
EOF
chmod +x "$fakebin/docker"
write_audit failed services services operator_assessment_required "$id_api" "$id_front" "$bundle"
: > "$docker_marker"
rm -f "$docker_marker"
(cd "$rollback_fixture"&&PATH="$fakebin:$PATH" RSP_R5_DOCKER_MARKER="$docker_marker" ENV_FILE="$env_file" DEPLOYMENT_STATE_FILE="$state" PROJECT_NAME=rsp07f-r5-posix STATE_FILE="$audit" LEVEL=Application CONFIRM=DATABASE_BACKWARD_COMPATIBLE BACKUP_DIR="$backup_dir" ADMIN_EMAIL=fixture@example.test ADMIN_PASSWORD_FILE="$password_file" "$rollback_fixture/ops/rollback.sh") > "$temp/rollback-app.out"
grep -Fq ROLLBACK_OK "$temp/rollback-app.out"
[ -e "$docker_marker" ]
grep -Fq 'ROLLBACK_STATUS=success' "$audit"

echo RSP07F_R5_POSIX_OK
