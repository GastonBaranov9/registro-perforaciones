#!/bin/sh
set -eu
[ "$#" -eq 2 ] || { echo "uso: test-deployment-state-posix.sh REPO STATE" >&2; exit 2; }
. "$1/ops/deployment-state.sh"

digest=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
for ref in \
  repo:v1 \
  registry.example/repo:v1 \
  registry.example:5000/repo:v1 \
  registry.example/team/repo:v1 \
  "registry.example/repo@sha256:$digest" \
  "registry.example:5000/team/repo@sha256:$digest" \
  "registry.example/team/repo:v1@sha256:$digest"
do
  deployment_state_validate_image "$ref"
done
for ref in \
  repo \
  registry.example/repo \
  registry.example:5000/repo \
  registry.example/team/repo \
  repo:latest \
  repo:Latest \
  repo:LATEST \
  repo: \
  repo@sha256: \
  repo@sha256:1234 \
  "repo@sha256:$digest@sha256:$digest"
do
  if deployment_state_validate_image "$ref" 2>/dev/null; then
    echo "referencia mutable o malformada aceptada: $ref" >&2
    exit 1
  fi
done

deployment_state_read "$2"
printf '%s|%s\n' "$DS_APP_VERSION" "$DS_CONFIG_HASH"
deployment_state_write_atomic "$2" example/api:n2 example/front:n2 n2 fedcba
printf '%s|%s\n' "$DS_APP_VERSION" "$DS_CONFIG_HASH"
