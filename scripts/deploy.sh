#!/bin/sh
set -eu

fail(){
  echo "deploy launcher: $*" >&2
  exit 1
}

script_dir=$(CDPATH= cd -- "$(dirname "$0")" 2>/dev/null && pwd) || fail "no se pudo resolver el directorio del launcher"
repo=$(CDPATH= cd -- "$script_dir/.." 2>/dev/null && pwd) || fail "no se pudo resolver la raiz del repositorio"
deploy="$repo/ops/deploy.sh"
compose="$repo/docker-compose.production.yaml"

[ -f "$deploy" ] || fail "no existe $deploy"
[ -f "$compose" ] || fail "no existe $compose"
cd -- "$repo" || fail "no se pudo acceder a la raiz del repositorio: $repo"
exec "$deploy" "$@"
