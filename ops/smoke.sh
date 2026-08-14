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
env_value(){ awk -v key="$1" 'index($0,key "=")==1{value=substr($0,length(key)+2)} END{print value}' "$ENV_FILE"; }
origin=$(env_value PUBLIC_ORIGIN);host=$(env_value PUBLIC_HOST)
[ -n "$origin" ] && [ -n "$host" ] || { echo "Falta origin/host" >&2; exit 2; }
port=$(printf '%s' "$origin"|sed -n 's#^https://[^:/]*:\([0-9][0-9]*\)$#\1#p');[ -n "$port" ]||port=443
tmp=$(mktemp -d);trap 'rm -rf "$tmp"' EXIT HUP INT TERM
body=$tmp/body;headers=$tmp/headers;cookies=$tmp/cookies;old_cookies=$tmp/old-cookies
compose(){ docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --env-file "$DEPLOYMENT_STATE_FILE" -f "$COMPOSE_FILE" "$@"; }
request(){ curl --insecure --silent --show-error --resolve "$host:$port:127.0.0.1" -o "$body" -w '%{http_code}' "$@"; }
expect(){ actual=$1;expected=$2;step=$3;[ "$actual" = "$expected" ]||{ echo "$step devolvio $actual, esperado $expected" >&2;exit 1;}; }
expect "$(request -D "$headers" "$origin/")" 200 root
grep -q '<app-root' "$body"
for header in 'X-Content-Type-Options: nosniff' 'Referrer-Policy: same-origin' 'X-Frame-Options: DENY' 'Permissions-Policy:' 'Content-Security-Policy:';do grep -qi "$header" "$headers"||{ echo "Falta header de seguridad" >&2;exit 1;};done
expect "$(request "$origin/pozos-detail/1")" 200 deep_route
expect "$(request "$origin/api/health")" 200 health
expect "$(request "$origin/api/ready")" 200 ready
expect "$(request "$origin/api/docs")" 404 swagger
password=$(tr -d '\r\n' < "$ADMIN_PASSWORD_FILE");jq -nc --arg email "$ADMIN_EMAIL" --arg password "$password" '{email:$email,password:$password}' > "$tmp/login.json";unset password
expect "$(request -D "$headers" -c "$cookies" -H "Origin: $origin" -H 'Content-Type: application/json' --data-binary @"$tmp/login.json" "$origin/api/login")" 200 login
grep -Eqi '^set-cookie: rsp_session=.*HttpOnly.*Secure.*SameSite=Lax' "$headers";grep -Eqi '^set-cookie: rsp_csrf=.*Secure.*SameSite=Lax' "$headers"
csrf=$(awk -F '\t' '$6=="rsp_csrf"{print $7;exit}' "$cookies");[ -n "$csrf" ];cp "$cookies" "$old_cookies"
expect "$(request -b "$cookies" "$origin/api/login")" 200 authenticated
expect "$(request -X POST -b "$cookies" -H "Origin: $origin" "$origin/api/logout")" 403 csrf
expect "$(request -b "$cookies" "$origin/api/usuarios/0/pozos")" 200 wells
well=$(jq -er '.[0].id_pozo' "$body");owner=$(jq -er '.[0].id_propietario' "$body")
expect "$(request -b "$cookies" "$origin/api/usuarios/$owner/pozos/$well")" 200 detail
expect "$(request "$origin/api/usuarios/$owner/pozos/$well/foto")" 401 protected_photo
expect "$(request -b "$cookies" "$origin/api/usuarios/$owner/pozos/$well/foto")" 200 photo;[ -s "$body" ]
expect "$(request -b "$cookies" "$origin/api/usuarios/$owner/pozos/$well/informe-pdf")" 200 pdf;head -c 4 "$body"|grep -q '%PDF'
if ws=$(curl --insecure --silent --show-error --include --max-time 2 --resolve "$host:$port:127.0.0.1" -b "$cookies" -H "Origin: $origin" -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$origin/ws" 2>&1);then ws_code=0;else ws_code=$?;fi
case "$ws_code" in 0|28) ;; *) echo "WebSocket fallo" >&2;exit 1;;esac;printf '%s' "$ws"|grep -q 'HTTP/1.1 101'
for service in api front postgres;do id=$(compose ps -q "$service");[ -n "$id" ];[ "$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$id")" = '{}' ]||{ echo "$service publica puertos" >&2;exit 1;};done
expect "$(request -X POST -b "$cookies" -H "Origin: $origin" -H "X-CSRF-Token: $csrf" "$origin/api/logout")" 204 logout
expect "$(request -b "$old_cookies" "$origin/api/login")" 401 revoked
echo SMOKE_OK
