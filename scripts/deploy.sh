#!/bin/sh
set -eu

echo "DEPLOY_FAILED: el deploy remoto legado con 'docker compose down' fue deshabilitado." >&2
echo "Use ops/deploy.ps1 con project, env, imágenes inmutables, backup y credenciales de smoke explícitos." >&2
exit 2
