#!/bin/sh
set -eu

deployment_state_validate_image() {
  case "$1" in
    ''|latest|*:latest) echo "deployment state: image ref invalida" >&2; return 1 ;;
    *[!A-Za-z0-9._/@:-]*) echo "deployment state: image ref invalida" >&2; return 1 ;;
  esac
  case "$1" in [A-Za-z0-9]*) ;; *) return 1 ;; esac
}

deployment_state_validate_identifier() {
  case "$1" in ''|*[!A-Za-z0-9._-]*) echo "deployment state: identificador invalido" >&2; return 1 ;; esac
}

deployment_state_canonical() {
  deployment_state_validate_image "$1"
  deployment_state_validate_image "$2"
  deployment_state_validate_identifier "$3"
  deployment_state_validate_identifier "$4"
  printf 'DEPLOYMENT_STATE_FORMAT=1\nAPI_IMAGE_REF=%s\nFRONT_IMAGE_REF=%s\nAPP_VERSION=%s\nGIT_SHA=%s\n' "$1" "$2" "$3" "$4"
}

deployment_state_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    deployment_state_canonical "$1" "$2" "$3" "$4" | sha256sum | awk '{print $1}'
  else
    deployment_state_canonical "$1" "$2" "$3" "$4" | shasum -a 256 | awk '{print $1}'
  fi
}

deployment_state_read() {
  [ -f "$1" ] || { echo "deployment state: archivo inexistente" >&2; return 1; }
  DS_FORMAT= DS_API_IMAGE= DS_FRONT_IMAGE= DS_APP_VERSION= DS_GIT_SHA= DS_CONFIG_HASH=
  seen='|'
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; *=*) ;; *) echo "deployment state: linea invalida" >&2; return 1 ;; esac
    key=${line%%=*}; value=${line#*=}
    [ -n "$value" ] || { echo "deployment state: valor vacio" >&2; return 1; }
    case "$seen" in *"|$key|"*) echo "deployment state: clave duplicada" >&2; return 1 ;; esac
    seen="${seen}${key}|"
    case "$key" in
      DEPLOYMENT_STATE_FORMAT) DS_FORMAT=$value ;;
      API_IMAGE_REF) DS_API_IMAGE=$value ;;
      FRONT_IMAGE_REF) DS_FRONT_IMAGE=$value ;;
      APP_VERSION) DS_APP_VERSION=$value ;;
      GIT_SHA) DS_GIT_SHA=$value ;;
      DEPLOY_CONFIG_SHA256) DS_CONFIG_HASH=$value ;;
      *) echo "deployment state: clave no permitida" >&2; return 1 ;;
    esac
  done < "$1"
  [ "$DS_FORMAT" = 1 ] && [ -n "$DS_API_IMAGE" ] && [ -n "$DS_FRONT_IMAGE" ] && [ -n "$DS_APP_VERSION" ] && [ -n "$DS_GIT_SHA" ] && [ -n "$DS_CONFIG_HASH" ] || {
    echo "deployment state: faltan claves" >&2; return 1;
  }
  expected=$(deployment_state_hash "$DS_API_IMAGE" "$DS_FRONT_IMAGE" "$DS_APP_VERSION" "$DS_GIT_SHA")
  [ "$DS_CONFIG_HASH" = "$expected" ] || { echo "deployment state: checksum invalido" >&2; return 1; }
}

deployment_state_write_atomic() {
  target=$1; api=$2; front=$3; version=$4; git_sha=$5
  parent=$(dirname "$target")
  [ -d "$parent" ] || { echo "deployment state: directorio inexistente" >&2; return 1; }
  temp="$parent/.$(basename "$target").$$.tmp"
  trap 'rm -f "$temp"' EXIT HUP INT TERM
  canonical=$(deployment_state_canonical "$api" "$front" "$version" "$git_sha")
  hash=$(deployment_state_hash "$api" "$front" "$version" "$git_sha")
  printf '%s\nDEPLOY_CONFIG_SHA256=%s\n' "$canonical" "$hash" > "$temp"
  chmod 600 "$temp"
  deployment_state_read "$temp"
  mv -f "$temp" "$target"
  trap - EXIT HUP INT TERM
  deployment_state_read "$target"
}
