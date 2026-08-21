#!/bin/sh
set -eu
[ "$#" -eq 2 ] || { echo "uso: test-deployment-state-posix.sh REPO STATE" >&2; exit 2; }
. "$1/ops/deployment-state.sh"

digest=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
sha_n=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
sha_n2=cccccccccccccccccccccccccccccccccccccccc
for ref in \
  "repo:$sha_n" \
  "registry.example/repo:$sha_n" \
  "registry.example:5000/team/repo:$sha_n" \
  "registry.example/repo@sha256:$digest" \
  "registry.example:5000/team/repo@sha256:$digest" \
  "registry.example/team/repo:v1@sha256:$digest"
do
  deployment_state_validate_image "$ref" "$sha_n"
done
for ref in \
  repo \
  registry.example/repo \
  registry.example:5000/repo \
  registry.example/team/repo \
  repo:latest \
  repo:Latest \
  repo:LATEST \
  repo:production \
  repo:stable \
  repo:v1 \
  "repo:${sha_n}-prod" \
  repo: \
  repo@sha256: \
  repo@sha256:1234 \
  "repo@sha256:$(printf '%s' "$digest" | tr '[:lower:]' '[:upper:]')" \
  "repo@sha256:$digest@sha256:$digest"
do
  if deployment_state_validate_image "$ref" "$sha_n" 2>/dev/null; then
    echo "referencia mutable o malformada aceptada: $ref" >&2
    exit 1
  fi
done
deployment_state_validate_remote_image "registry.example/repo@sha256:$digest" "$sha_n"
deployment_state_validate_remote_image "registry.example/team/repo:v1@sha256:$digest" "$sha_n"
for ref in "repo:$sha_n" repo:production; do
  if deployment_state_validate_remote_image "$ref" "$sha_n" 2>/dev/null; then
    echo "referencia remota sin digest aceptada: $ref" >&2
    exit 1
  fi
done

deployment_state_read "$2"
printf '%s|%s\n' "$DS_APP_VERSION" "$DS_CONFIG_HASH"
deployment_state_write_atomic "$2" "example/api:$sha_n2" "example/front:$sha_n2" n2 "$sha_n2"
printf '%s|%s\n' "$DS_APP_VERSION" "$DS_CONFIG_HASH"
