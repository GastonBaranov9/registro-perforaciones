#!/bin/sh
set -eu

# PUBLIC_* sigue siendo el contrato web canonico. Los hosts nuevos son opt-in.
fail() { echo "$1" >&2; exit 1; }
validate_host() {
  printf '%s\n' "$2" | LC_ALL=C awk '
    NR != 1 || length($0) > 253 || $0 !~ /^[a-z0-9.-]+$/ { exit 1 }
    { n = split($0, labels, "."); if (n < 2) exit 1
      for (i = 1; i <= n; i++)
        if (length(labels[i]) < 1 || length(labels[i]) > 63 ||
            labels[i] ~ /^-/ || labels[i] ~ /-$/) exit 1
    }' || fail "$1 debe ser un hostname DNS concreto sin wildcard"
}
: "${PUBLIC_HOST:?Falta PUBLIC_HOST}"
: "${PUBLIC_ORIGIN:?Falta PUBLIC_ORIGIN}"
APP_HOST=${APP_HOST:-$PUBLIC_HOST}
API_HOST=${API_HOST:-$PUBLIC_HOST}
validate_host PUBLIC_HOST "$PUBLIC_HOST"
validate_host APP_HOST "$APP_HOST"
validate_host API_HOST "$API_HOST"
[ "$APP_HOST" = "$PUBLIC_HOST" ] || fail "APP_HOST debe coincidir con PUBLIC_HOST (origen web)"
PUBLIC_ORIGIN=${PUBLIC_ORIGIN%/}
case "$PUBLIC_ORIGIN" in
  "https://$PUBLIC_HOST") origin_port="" ;;
  "https://$PUBLIC_HOST":*)
    port=${PUBLIC_ORIGIN#"https://$PUBLIC_HOST":}
    case "$port" in ''|*[!0-9]*|0*) fail "PUBLIC_ORIGIN tiene un puerto invalido" ;; esac
    [ "${#port}" -le 5 ] && [ "$port" -le 65535 ] && [ "$port" -ne 443 ] || fail "PUBLIC_ORIGIN tiene un puerto invalido o no canonico"
    origin_port=":$port" ;;
  *) fail "PUBLIC_ORIGIN debe ser HTTPS y coincidir con PUBLIC_HOST sin ruta" ;;
esac
# Ambos hosts usan el mismo listener/publicacion HTTPS; nunca redirigir APK a APP.
API_ORIGIN="https://$API_HOST$origin_port"
export PUBLIC_ORIGIN APP_HOST API_HOST API_ORIGIN
# Sustituir solo variables propias, nunca variables de nginx desde el entorno.
export NGINX_ENVSUBST_FILTER='^(PUBLIC_ORIGIN|APP_HOST|API_HOST|API_ORIGIN|HSTS_HEADER)$'

case "${HSTS_ENABLED:-false}" in
  true) HSTS_HEADER="max-age=31536000" ;;
  false) HSTS_HEADER="" ;;
  *) echo "HSTS_ENABLED debe ser true o false" >&2; exit 1 ;;
esac
export HSTS_HEADER

exec /docker-entrypoint.sh nginx -g 'daemon off;'
