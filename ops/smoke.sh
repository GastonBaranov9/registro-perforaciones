#!/bin/sh
set -eu
: "${ENV_FILE:?Falta ENV_FILE}"
: "${DEPLOYMENT_STATE_FILE:?Falta DEPLOYMENT_STATE_FILE}"
: "${PROJECT_NAME:?Falta PROJECT_NAME}"
: "${ADMIN_EMAIL:?Falta ADMIN_EMAIL}"
: "${ADMIN_PASSWORD_FILE:?Falta ADMIN_PASSWORD_FILE}"
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yaml}
command -v curl >/dev/null 2>&1 || { echo "Falta curl" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "Falta jq" >&2; exit 2; }
command -v od >/dev/null 2>&1 || { echo "Falta od" >&2; exit 2; }
. "$(dirname "$0")/secret-file.sh"
env_value(){ awk -v key="$1" 'index($0,key "=")==1{value=substr($0,length(key)+2)} END{print value}' "$ENV_FILE"; }
origin=$(env_value PUBLIC_ORIGIN);host=$(env_value PUBLIC_HOST)
origin=${origin%/}
case "$origin" in "https://$host"|"https://$host:"*) ;; *) echo 'Origin HTTPS no canonica' >&2;exit 2;; esac
suffix=${origin#https://$host}
case "$suffix" in '') port=443;; :*) port=${suffix#:};; *) exit 2;; esac
case "$port" in ''|*[!0-9]*) echo 'Puerto logico invalido' >&2;exit 2;;esac
[ "$port" -ge 1 ] && [ "$port" -le 65535 ] || exit 2
connect_port=${SMOKE_CONNECT_PORT:-$(env_value HTTPS_PORT)};connect_port=${connect_port:-$port}
case "$connect_port" in ''|*[!0-9]*) echo 'Puerto de conexion invalido' >&2;exit 2;;esac
[ "$connect_port" -ge 1 ] && [ "$connect_port" -le 65535 ] || exit 2
transport(){
  if [ -n "${SMOKE_CA_FILE:-}" ];then set -- --cacert "$SMOKE_CA_FILE" "$@";fi
  curl --silent --show-error --noproxy '*' --connect-to "$host:$port:127.0.0.1:$connect_port" "$@"
}
tmp=$(mktemp -d);trap 'rm -rf "$tmp"' EXIT HUP INT TERM
body=$tmp/body;headers=$tmp/headers;cookies=$tmp/cookies;old_cookies=$tmp/old-cookies
compose(){ docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --env-file "$DEPLOYMENT_STATE_FILE" -f "$COMPOSE_FILE" "$@"; }
request(){ transport -o "$body" -w '%{http_code}' "$@"; }
expect(){ actual=$1;expected=$2;step=$3;[ "$actual" = "$expected" ]||{ echo "$step devolvio $actual, esperado $expected" >&2;exit 1;}; }
pass(){ printf 'PASS %s\n' "$1"; }
skip(){ printf 'SKIP %s: %s\n' "$1" "$2"; }
expect "$(request -D "$headers" "$origin/")" 200 root
grep -q '<app-root' "$body"
for header in 'X-Content-Type-Options: nosniff' 'Referrer-Policy: same-origin' 'X-Frame-Options: DENY' 'Permissions-Policy:' 'Content-Security-Policy:';do grep -qi "$header" "$headers"||{ echo "Falta header de seguridad" >&2;exit 1;};done
expect "$(request "$origin/pozos-detail/1")" 200 deep_route
expect "$(request "$origin/api/health")" 200 health
expect "$(request "$origin/api/ready")" 200 ready
expect "$(request "$origin/api/docs")" 404 swagger
if [ "${SMOKE_PUBLIC_ONLY:-false}" = true ];then echo PUBLIC_SMOKE_OK;exit 0;fi
secret_file_write_login_json "$ADMIN_PASSWORD_FILE" "$ADMIN_EMAIL" "$tmp/login.json"
expect "$(request -D "$headers" -c "$cookies" -H "Origin: $origin" -H 'Content-Type: application/json' --data-binary @"$tmp/login.json" "$origin/api/login")" 200 login
grep -Eqi '^set-cookie: rsp_session=.*HttpOnly.*Secure.*SameSite=Lax' "$headers";grep -Eqi '^set-cookie: rsp_csrf=.*Secure.*SameSite=Lax' "$headers"
csrf=$(awk -F '\t' '$6=="rsp_csrf"{print $7;exit}' "$cookies");[ -n "$csrf" ];cp "$cookies" "$old_cookies"
expect "$(request -b "$cookies" "$origin/api/login")" 200 authenticated
expect "$(request -X POST -b "$cookies" -H "Origin: $origin" "$origin/api/logout")" 403 csrf
expect "$(request -b "$cookies" "$origin/api/usuarios/0/pozos")" 200 wells
wells_json=$tmp/wells.json;cp "$body" "$wells_json"
jq -e -f "$(dirname "$0")/smoke-wells.jq" "$wells_json" >/dev/null || { echo "Lista de pozos JSON invalida" >&2;exit 1; }
pass wells-list
well_count=$(jq -r 'length' "$wells_json")
if [ "$well_count" -eq 0 ];then
  skip well-detail 'no wells available'
  skip photo 'no wells available'
  skip pdf 'no well available'
else
  well=$(jq -er '.[0].id_pozo' "$wells_json");owner=$(jq -er '.[0].id_propietario // 0' "$wells_json")
  expect "$(request -b "$cookies" "$origin/api/usuarios/$owner/pozos/$well")" 200 detail;pass well-detail
  expect "$(request -b "$cookies" "$origin/api/usuarios/$owner/pozos/$well/informe-pdf")" 200 pdf
  [ "$(head -c 4 "$body")" = '%PDF' ] || { echo "PDF invalido" >&2;exit 1; };pass pdf
  photo_well=$(jq -r '[.[]|select((.foto_url? // "") != "")][0].id_pozo // empty' "$wells_json")
  photo_owner=$(jq -r '[.[]|select((.foto_url? // "") != "")][0].id_propietario // 0' "$wells_json")
  if [ -z "$photo_well" ] || [ -z "$photo_owner" ];then
    skip photo 'no photo available'
  else
    expect "$(request "$origin/api/usuarios/$photo_owner/pozos/$photo_well/foto")" 401 protected_photo
    expect "$(request -D "$headers" -b "$cookies" "$origin/api/usuarios/$photo_owner/pozos/$photo_well/foto")" 200 photo
    mime=$(awk 'BEGIN{IGNORECASE=1} /^Content-Type:/{gsub("\\r","");sub(/^[^:]*:[[:space:]]*/,"");print tolower($0);exit}' "$headers")
    case "$mime" in
      image/jpeg*) [ "$(od -An -tx1 -N3 "$body"|tr -d ' \n')" = ffd8ff ] || { echo "Firma JPEG invalida" >&2;exit 1; };;
      image/png*) [ "$(od -An -tx1 -N8 "$body"|tr -d ' \n')" = 89504e470d0a1a0a ] || { echo "Firma PNG invalida" >&2;exit 1; };;
      *) echo "Content-Type de foto invalido" >&2;exit 1;;
    esac
    pass photo
  fi
fi
if ws=$(transport --include --max-time 2 -b "$cookies" -H "Origin: $origin" -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$origin/ws" 2>&1);then ws_code=0;else ws_code=$?;fi
case "$ws_code" in 0|28) ;; *) echo "WebSocket fallo" >&2;exit 1;;esac;printf '%s' "$ws"|grep -q 'HTTP/1.1 101'
for service in api front postgres;do id=$(compose ps -q "$service");[ -n "$id" ];[ "$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$id")" = '{}' ]||{ echo "$service publica puertos" >&2;exit 1;};done
expect "$(request -X POST -b "$cookies" -H "Origin: $origin" -H "X-CSRF-Token: $csrf" "$origin/api/logout")" 204 logout
expect "$(request -b "$old_cookies" "$origin/api/login")" 401 revoked
echo SMOKE_OK
