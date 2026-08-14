#!/bin/sh
set -eu
[ "$#" -eq 2 ] || { echo "uso: test-deployment-state-posix.sh REPO STATE" >&2; exit 2; }
. "$1/ops/deployment-state.sh"
deployment_state_read "$2"
printf '%s|%s\n' "$DS_APP_VERSION" "$DS_CONFIG_HASH"
deployment_state_write_atomic "$2" example/api:n2 example/front:n2 n2 fedcba
printf '%s|%s\n' "$DS_APP_VERSION" "$DS_CONFIG_HASH"
