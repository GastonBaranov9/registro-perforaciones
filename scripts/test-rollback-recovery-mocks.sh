#!/bin/sh
# Actual rollback functions/body; fail-closed executables never reach a Docker daemon.
set -eu
repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d);trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/ops" "$tmp/bin"
tr -d '\r' < "$repo/ops/rollback.sh" | awk '/^compose\(\)/{copy=1} copy{print}' > "$tmp/ops/body.sh"
cat > "$tmp/ops/run.sh" <<'SH'
#!/bin/sh
set -eu
previous_api=old-api;previous_front=old-front;previous_version=old;previous_sha=old-sha;previous_hash=old-hash
deployment_state_write_atomic(){
  echo persist >> "$MOCK_LOG"
  if [ "$MOCK_CASE" = state-write ];then echo 'Original state write failure' >&2;return 19;fi
}
deployment_state_read(){ DS_CONFIG_HASH=old-hash; }
. "$(dirname "$0")/body.sh"
SH
cat > "$tmp/ops/smoke.sh" <<'SH'
#!/bin/sh
echo smoke >> "$MOCK_LOG"
case "$MOCK_CASE" in success|audit-space|audit-permission|state-write) echo SMOKE_OK;;*) echo 'Original smoke failure' >&2;exit 7;;esac
SH
cat > "$tmp/bin/mv" <<'SH'
#!/bin/sh
echo audit >> "$MOCK_LOG"
case "$MOCK_CASE" in
  audit-space|smoke-audit) echo 'Mock disk full' >&2;exit 28;;
  audit-permission) echo 'Mock access denied' >&2;exit 13;;
esac
# Audit-only mock: copy bytes to the destination, no system mv fallback.
[ "$1" = -f ] && [ "$3" = "$STATE_FILE" ] || exit 99
cat "$2" > "$3"
SH
cat > "$tmp/bin/docker" <<'SH'
#!/bin/sh
set -eu
echo "$*" >> "$MOCK_LOG"
last=;for arg in "$@";do last=$arg;done
case "$*" in
  ps*'label=com.docker.compose.service='*)
    case "$*" in *'label=com.docker.compose.project=rsp-rollback-mock '*) ;;*) exit 99;;esac
    if [ "$MOCK_CASE" = list-fail ] && [ "$last" = label=com.docker.compose.service=proxy ];then echo 'Mock list unavailable' >&2;exit 9;fi
    printf '%s-id\n' "${last#label=com.docker.compose.service=}";;
  inspect*State.Status*)
    if [ "$MOCK_CASE" = unverified ] && [ "$last" = proxy-id ];then echo 'Mock inspect unavailable' >&2;exit 9;fi
    s=$(cat "$MOCK_ROOT/${last%-id}-state")
    case "$*" in *State.Health*) echo "$s/healthy";;*) echo "$s";;esac;;
  stop*)
    if [ "$last" = proxy-id ];then
      case "$MOCK_CASE:$*" in stop-all:*|first-stop:*'--time 10'*) echo 'Mock stop failed' >&2;exit 9;;unverified:*) exit 0;;esac
    fi
    echo exited > "$MOCK_ROOT/${last%-id}-state";;
  compose*)
    case "$*" in *'--project-name rsp-rollback-mock '*) ;;*) exit 99;;esac
    case "$*" in
      *'config --quiet'|*'rm -f maintenance') :;;
      *'config --images') printf 'old-api\nold-front\n';;
      *'stop '*) echo exited > "$MOCK_ROOT/$last-state";;
      *'up '*maintenance)
        case "$MOCK_CASE:$*" in maintenance-fail:*--no-recreate*) echo 'Mock maintenance unavailable' >&2;exit 9;;esac
        echo running > "$MOCK_ROOT/maintenance-state";;
      *'up '*front)
        if [ "$MOCK_CASE" = already-safe ];then echo 'Original services failure' >&2;exit 8;fi
        echo running > "$MOCK_ROOT/api-state";;
      *'up '*proxy) echo running > "$MOCK_ROOT/proxy-state";;
      *) echo 'Unexpected/forbidden Docker command' >&2;exit 99;;
    esac;;
  *) echo 'Unexpected/forbidden Docker command' >&2;exit 99;;
esac
SH
chmod +x "$tmp/bin/"* "$tmp/ops/"*.sh
export PATH="$tmp/bin:$PATH" MOCK_ROOT="$tmp" MOCK_LOG="$tmp/commands"
export ENV_FILE="$tmp/env" DEPLOYMENT_STATE_FILE="$tmp/deployment" PROJECT_NAME=rsp-rollback-mock COMPOSE_FILE="$tmp/compose"
export STATE_FILE="$tmp/audit" LEVEL=Application ADMIN_EMAIL=fixture@example.test ADMIN_PASSWORD_FILE="$tmp/password"
count=0
for scenario in success smoke smoke-audit audit-space audit-permission first-stop stop-all unverified list-fail maintenance-fail already-safe state-write;do
  export MOCK_CASE=$scenario
  : > "$MOCK_LOG";echo BASE=fixture > "$STATE_FILE"
  for service in proxy api;do echo running > "$tmp/$service-state";done
  echo exited > "$tmp/maintenance-state"
  if sh "$tmp/ops/run.sh" > "$tmp/output" 2>&1;then code=0;else code=$?;fi
  if [ "$scenario" = success ];then
    [ "$code" -eq 0 ];grep -qx ROLLBACK_OK "$tmp/output";grep -qx ROLLBACK_STATUS=success "$STATE_FILE"
    if grep -q '^ps ' "$MOCK_LOG";then echo 'Unexpected recovery';exit 1;fi
  else
    [ "$code" -ne 0 ]
    if grep -qx ROLLBACK_OK "$tmp/output";then echo 'False success';exit 1;fi
    case "$scenario" in
      stop-all|unverified|list-fail)
        grep -q 'RECOVERY_CRITICAL:.*INTERVENCION MANUAL URGENTE' "$tmp/output"
        grep -qx RECOVERY_PUBLIC_BLOCKED=false "$tmp/output"
        [ "$(cat "$tmp/api-state")" = exited ];;
      *) grep -qx RECOVERY_PUBLIC_BLOCKED=true "$tmp/output";;
    esac
    awk '/^ps -a -q --filter/{copy=1} copy{print}' "$MOCK_LOG" > "$tmp/recovery"
    if grep -Eq 'up .*proxy|stop maintenance|force-recreate|restore|persist' "$tmp/recovery";then echo 'Forbidden recovery action';exit 1;fi
    awk '/^audit$/{a=NR} /label=com.docker.compose.service=proxy$/{v=NR} END{exit !(a>v && v>0)}' "$tmp/recovery"
    case "$scenario" in
      audit-space) [ "$code" -eq 28 ];grep -q 'audit: Mock disk full' "$tmp/output";;
      audit-permission) [ "$code" -eq 13 ];grep -q 'audit: Mock access denied' "$tmp/output";;
      already-safe) [ "$code" -eq 8 ];if grep -Eq 'up .*maintenance|stop --time' "$tmp/recovery";then echo 'Unnecessary recovery change';exit 1;fi;;
      state-write) [ "$code" -eq 19 ];grep -q 'Original state write failure' "$tmp/output";;
      *) [ "$code" -eq 7 ];grep -q 'Original smoke failure' "$tmp/output";;
    esac
    if [ "$scenario" = smoke-audit ];then grep -q 'audit: Mock disk full' "$tmp/output";fi
    if [ "$scenario" = first-stop ];then grep -q 'stop --time 0 proxy-id' "$tmp/recovery";grep -q 'up .*maintenance' "$tmp/recovery";fi
    if [ "$scenario" = maintenance-fail ];then grep -qx RECOVERY_MAINTENANCE_VERIFIED=false "$tmp/output";grep -q 'start/maintenance' "$tmp/output";fi
  fi
  echo "PASS POSIX rollback/$scenario";count=$((count+1))
done
echo "ROLLBACK_POSIX_MOCKS_OK $count/$count; no real Docker commands"
