#!/bin/sh
# Only temporary scripts and a fail-closed docker executable; no daemon access.
set -eu
repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d);trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir -p "$tmp/ops" "$tmp/bin"
for f in deploy.sh deployment-state.sh deployment-audit.sh;do tr -d '\r' < "$repo/ops/$f" > "$tmp/ops/$f";done
# Inject audit failures only into the disposable copy; production scripts have no test hooks.
cat > "$tmp/audit-mock.sh" <<'SH'
write_audit(){
  printf 'audit/%s/%s\n' "$status" "$phase_started" >> "$MOCK_LOG"
  if [ "$MOCK_FAILURE" = public-audit ] && [ "$status" = failed ];then echo 'Mock disk full during recovery audit' >&2;return 28;fi
  if [ "$phase_started" = complete ];then
    case "$MOCK_FAILURE" in audit-space) echo 'Mock disk full' >&2;return 28;;audit-permission) echo 'Mock access denied' >&2;return 13;;esac
  fi
  write_underlying_audit
}
SH
awk -v wrapper="$tmp/audit-mock.sh" '
  /^write_audit\(\)/ {sub(/write_audit/, "write_underlying_audit")}
  /^trap on_exit/ {while ((getline line < wrapper)>0) print line;close(wrapper)}
  {print}
' "$tmp/ops/deploy.sh" > "$tmp/deploy-with-mocks.sh"
mv "$tmp/deploy-with-mocks.sh" "$tmp/ops/deploy.sh"
printf 'fixture\n' > "$tmp/production.env"
printf 'fixture\n' > "$tmp/compose.yaml"
printf 'fixture\n' > "$tmp/password"
cat > "$tmp/ops/prepare-photo-storage.sh" <<'SH'
#!/bin/sh
echo 'PHOTO_STORAGE_READY DB_LEDGER=present'
SH
cat > "$tmp/ops/smoke.sh" <<'SH'
#!/bin/sh
set -eu
if [ "${SMOKE_PUBLIC_ONLY:-false}" = true ];then
  echo public-smoke >> "$MOCK_LOG"
  [ -f "$MOCK_ROOT/critical" ]
  case "$MOCK_FAILURE" in public*) echo 'Mock public failure' >&2;exit 7;;esac
  echo PUBLIC_SMOKE_OK
else
  echo internal-smoke >> "$MOCK_LOG"
  [ -f "$MOCK_ROOT/maintenance" ];[ "$SMOKE_CONNECT_PORT" = 18443 ]
  [ "$MOCK_FAILURE" != smoke ]
  touch "$MOCK_ROOT/critical"
  echo SMOKE_OK
fi
SH
cat > "$tmp/bin/docker" <<'SH'
#!/bin/sh
set -eu
echo "$*" >> "$MOCK_LOG"
last=;for arg in "$@";do last=$arg;done
case "$*" in
  image\ inspect*) printf 'sha256:%064d\n' 0;;
  ps*'label=com.docker.compose.service='*)
    case "$*" in *'label=com.docker.compose.project=rsp07f-r3-mock '*) ;;*) exit 9;;esac
    printf '%s-id\n' "${last#label=com.docker.compose.service=}";;
  inspect*State.Status*)
    if [ "$MOCK_FAILURE" = public-unverified ] && [ "$last" = proxy-id ];then echo 'Mock inspect unavailable' >&2;exit 9;fi
    s=$(cat "$MOCK_ROOT/${last%-id}-state")
    case "$*" in *State.Health*) printf '%s/healthy\n' "$s";;*) echo "$s";;esac;;
  stop*)
    if [ "$last" = proxy-id ];then
      case "$MOCK_FAILURE:$*" in public-stop-all:*|public-first-stop:*'--time 10'*) echo 'Mock stop failed' >&2;exit 9;;public-unverified:*) exit 0;;esac
    fi
    echo exited > "$MOCK_ROOT/${last%-id}-state";;
  inspect*Config.Image*) case "$last" in api-id) echo "fixture-api:$OLD_SHA";;front-id) echo "fixture-front:$OLD_SHA";;*) exit 9;;esac;;
  inspect*Config.Env*) echo APP_VERSION=old;;
  inspect*Image*) printf 'sha256:%064d\n' 0;;
  compose*'config --quiet') :;;
  compose*'config --images') sed -n 's/^API_IMAGE_REF=//p;s/^FRONT_IMAGE_REF=//p' "$DEPLOYMENT_STATE_FILE";;
  compose*'ps -q '*|compose*'ps -a -q '*) echo "$last-id";;
  compose*'build api front') :;;
  compose*'stop maintenance') [ -f "$MOCK_ROOT/critical" ];rm -f "$MOCK_ROOT/maintenance";echo exited > "$MOCK_ROOT/maintenance-state";;
  compose*'stop '*) echo exited > "$MOCK_ROOT/$last-state";;
  compose*'rm -f '*) :;;
  compose*'up '*maintenance)
    case "$MOCK_FAILURE:$*" in public-maintenance-fail:*--no-recreate*) echo 'Mock maintenance start failed' >&2;exit 9;;esac
    touch "$MOCK_ROOT/maintenance";echo running > "$MOCK_ROOT/maintenance-state";;
  compose*'up '*smoke-proxy) [ "$MOCK_FAILURE" != private-proxy ];echo running > "$MOCK_ROOT/smoke-proxy-state";;
  compose*'up '*front) [ "$MOCK_FAILURE" != services ];echo running > "$MOCK_ROOT/api-state";;
  compose*'up '*proxy) [ -f "$MOCK_ROOT/critical" ];echo running > "$MOCK_ROOT/proxy-state";;
  compose*'run --rm backup') [ -f "$MOCK_ROOT/maintenance" ];echo BACKUP_BUNDLE=rsp-backup-20261021T000000Z;;
  compose*'run --rm migrate') [ -f "$MOCK_ROOT/maintenance" ];[ "$MOCK_FAILURE" != migrate ];;
  *) echo "Unexpected/forbidden Docker command" >&2;exit 9;;
esac
SH
chmod +x "$tmp/bin/docker" "$tmp/ops/"*.sh
export PATH="$tmp/bin:$PATH" MOCK_ROOT="$tmp" MOCK_LOG="$tmp/commands"
export OLD_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
new_sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
export ENV_FILE="$tmp/production.env" DEPLOYMENT_STATE_FILE="$tmp/state.env" PROJECT_NAME=rsp07f-r3-mock
export BACKUP_DIR="$tmp/backup" STATE_DIR="$tmp/state" COMPOSE_FILE="$tmp/compose.yaml"
export TARGET_API_IMAGE="fixture-api:$new_sha" TARGET_FRONT_IMAGE="fixture-front:$new_sha" TARGET_VERSION=new TARGET_GIT_SHA="$new_sha" BUILD_IMAGES=true
export ADMIN_EMAIL=fixture@example.test ADMIN_PASSWORD_FILE="$tmp/password" SMOKE_INTERNAL_PORT=18443
. "$tmp/ops/deployment-state.sh"
. "$tmp/ops/deployment-audit.sh"
count=0
for scenario in success maintenance photo_storage backup images migrate services private-proxy health smoke persist_state public public-audit audit-space audit-permission public-first-stop public-stop-all public-unverified public-maintenance-fail;do
  rm -f "$tmp/maintenance" "$tmp/critical"
  : > "$MOCK_LOG"
  for service in proxy api;do echo running > "$tmp/$service-state";done
  for service in maintenance smoke-proxy;do echo exited > "$tmp/$service-state";done
  deployment_state_write_atomic "$DEPLOYMENT_STATE_FILE" "fixture-api:$OLD_SHA" "fixture-front:$OLD_SHA" old "$OLD_SHA"
  MOCK_FAILURE=$scenario;export MOCK_FAILURE
  case "$scenario" in maintenance|photo_storage|backup|images|health|persist_state) TEST_FAIL_AFTER_PHASE=$scenario;;*) TEST_FAIL_AFTER_PHASE=;;esac
  export TEST_FAIL_AFTER_PHASE
  if sh "$tmp/ops/deploy.sh" > "$tmp/output" 2>&1;then result=success;exit_code=0;else exit_code=$?;result=failed;fi
  if [ "$scenario" = success ];then
    [ "$result" = success ] && [ ! -f "$tmp/maintenance" ] && grep -q public-smoke "$MOCK_LOG" || { cat "$tmp/output";exit 1; }
  else
    [ "$result" = failed ] || { cat "$tmp/output";exit 1; }
    if [ "$scenario" != public-maintenance-fail ];then [ -f "$tmp/maintenance" ] || { cat "$tmp/output";exit 1; };fi
    case "$scenario" in public*|audit-space|audit-permission) :;;*)
      if grep -Eq 'stop maintenance|up .*180 proxy' "$MOCK_LOG";then echo 'Premature reopening';exit 1;fi
    esac
    if grep -q DEPLOY_OK "$tmp/output";then echo 'Failure declared success';exit 1;fi
    case "$scenario" in
      public-stop-all|public-unverified)
        grep -q RECOVERY_CRITICAL "$tmp/output"
        grep -q RECOVERY_PUBLIC_BLOCKED=false "$tmp/output"
        [ "$(cat "$tmp/api-state")" = exited ];;
      *) grep -q RECOVERY_PUBLIC_BLOCKED=true "$tmp/output" || { cat "$tmp/output";exit 1; };;
    esac
    awk '/^ps -a -q --filter/{recovery=1} recovery{print}' "$MOCK_LOG" > "$tmp/recovery-events"
    if grep -Eq 'stop maintenance|up .*180 proxy' "$tmp/recovery-events";then echo 'Recovery reopened public access';exit 1;fi
    awk '/^audit\/failed/{a=NR} /^inspect .*State.Status.* proxy-id$/{v=NR} END{exit !(a>v && v>0)}' "$tmp/recovery-events"
    case "$scenario" in
      public*) [ "$exit_code" -eq 7 ];grep -q 'Mock public failure' "$tmp/output";;
      audit-space) [ "$exit_code" -eq 28 ];grep -q 'Mock disk full' "$tmp/output";;
      audit-permission) [ "$exit_code" -eq 13 ];grep -q 'Mock access denied' "$tmp/output";;
    esac
    if [ "$scenario" = public-audit ];then grep -q 'audit: Mock disk full' "$tmp/output";fi
    if [ "$scenario" = public-first-stop ];then grep -q 'stop --time 0 proxy-id' "$tmp/recovery-events";grep -q 'up .*maintenance' "$tmp/recovery-events";fi
    if [ "$scenario" = smoke ];then
      if grep -Eq 'up .*maintenance|stop --time [0-9]+ proxy-id' "$tmp/recovery-events";then echo 'Already safe maintenance unnecessarily changed';exit 1;fi
    fi
  fi
  deployment_audit_read "$STATE_DIR/deploy-$PROJECT_NAME.env" "$PROJECT_NAME" "$DEPLOYMENT_STATE_FILE"
  [ "$DA_NOOP" = false ] || { echo 'Recovery incorrectly classified as no-op';exit 1; }
  echo "PASS POSIX maintenance/$scenario"
  count=$((count+1))
done
echo "DEPLOY_POSIX_MOCKS_OK $count/$count; no real Docker commands"
