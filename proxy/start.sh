#!/bin/sh
set -eu

case "${HSTS_ENABLED:-false}" in
  true) HSTS_HEADER="max-age=31536000" ;;
  false) HSTS_HEADER="" ;;
  *) echo "HSTS_ENABLED debe ser true o false" >&2; exit 1 ;;
esac
export HSTS_HEADER

exec /docker-entrypoint.sh nginx -g 'daemon off;'
