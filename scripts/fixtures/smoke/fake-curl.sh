#!/bin/sh
set -eu

scenario=${RSP_SMOKE_SCENARIO:?}
out= headers= cookie_jar= cookie= url= method=GET csrf=false
while [ "$#" -gt 0 ];do
  case "$1" in
    -o|--output) out=$2;shift 2;;
    -D|--dump-header) headers=$2;shift 2;;
    -c|--cookie-jar) cookie_jar=$2;shift 2;;
    -b|--cookie) cookie=$2;shift 2;;
    -X|--request) method=$2;shift 2;;
    -H|--header) case "$2" in X-CSRF-Token:*) csrf=true;;esac;shift 2;;
    --data-binary) method=POST;shift 2;;
    --resolve|-w|--write-out|--max-time) shift 2;;
    --insecure|--silent|--show-error|--include) shift;;
    http://*|https://*) url=$1;shift;;
    *) shift;;
  esac
done

if [ -z "$url" ];then echo 'fixture curl: URL ausente' >&2;exit 2;fi
if [ -n "$headers" ];then : >"$headers";fi
status=404 body='not found' body_kind=text

case "$url" in
  */ws)
    printf 'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'
    exit 0
    ;;
  */api/health|*/api/ready) status=200;body='{"status":"ok"}';;
  */api/docs) status=404;body='not found';;
  */api/login)
    if [ "$method" = POST ];then
      status=200;body='{"authenticated":true}'
      if [ -n "$cookie_jar" ];then
        printf '127.0.0.1\tFALSE\t/\tTRUE\t0\trsp_session\tfixture-session\n127.0.0.1\tFALSE\t/\tTRUE\t0\trsp_csrf\tfixture-csrf\n' >"$cookie_jar"
      fi
      if [ -n "$headers" ];then
        printf 'HTTP/1.1 200 OK\r\nSet-Cookie: rsp_session=fixture-session; HttpOnly; Secure; SameSite=Lax\r\nSet-Cookie: rsp_csrf=fixture-csrf; Secure; SameSite=Lax\r\n\r\n' >"$headers"
      fi
    else
      case "$cookie" in *old-cookies*|*cookies-copy*) status=401;; *) status=200;;esac
      body='{"authenticated":true}'
    fi
    ;;
  */api/logout)
    if [ "$csrf" = true ];then status=204;body='';else status=403;body='{"error":"csrf"}';fi
    ;;
  */api/usuarios/0/pozos)
    case "$scenario" in
      empty) status=200;body='[]';;
      no_photo) status=200;body='[{"id_pozo":1,"id_propietario":2,"foto_url":null}]';;
      valid_photo|missing_photo) status=200;body='[{"id_pozo":1,"id_propietario":2,"foto_url":"/api/usuarios/2/pozos/1/foto"}]';;
      second_photo) status=200;body='[{"id_pozo":1,"id_propietario":2,"foto_url":null},{"id_pozo":3,"id_propietario":4,"foto_url":"/api/usuarios/4/pozos/3/foto"}]';;
      api_500) status=500;body='{"error":"fixture"}';;
      malformed_json) status=200;body='[{"id_pozo":';;
      *) echo "fixture curl: escenario desconocido $scenario" >&2;exit 2;;
    esac
    ;;
  */api/usuarios/*/pozos/*/foto)
    if [ -z "$cookie" ];then status=401;body='{"error":"auth"}'
    elif [ "$scenario" = missing_photo ];then status=404;body='{"error":"missing"}'
    else
      status=200;body_kind=jpeg
      if [ -n "$headers" ];then printf 'HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\n\r\n' >"$headers";fi
    fi
    ;;
  */api/usuarios/*/pozos/*/informe-pdf) status=200;body='%PDF-fixture';;
  */api/usuarios/*/pozos/*) status=200;body='{"id_pozo":1,"id_propietario":2}';;
  */pozos-detail/1) status=200;body='<app-root></app-root>';;
  */)
    status=200;body='<app-root></app-root>'
    if [ -n "$headers" ];then
      printf 'HTTP/1.1 200 OK\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: same-origin\r\nX-Frame-Options: DENY\r\nPermissions-Policy: geolocation=()\r\nContent-Security-Policy: default-src self\r\n\r\n' >"$headers"
    fi
    ;;
esac

if [ -n "$out" ];then
  if [ "$body_kind" = jpeg ];then printf '\377\330\377\331' >"$out";else printf '%s' "$body" >"$out";fi
fi
printf '%s' "$status"
