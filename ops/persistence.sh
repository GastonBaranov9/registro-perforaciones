#!/bin/sh
# Shared by backup and restore. Only regular files/directories are supported;
# unsupported names/types fail closed rather than silently omitting data.
persistence_inventory() (
  set -eu
  root=$1; output=$2
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  cd "$root"
  find . -exec sh -c '
    for p do
      if printf "%s" "$p" | LC_ALL=C grep -q "[[:cntrl:]\\\\]"; then exit 1; fi
      case "$p" in ./.rsp-restore-*|./.rsp-previous-*) exit 1;; esac
      [ ! -L "$p" ] && { [ -f "$p" ] || [ -d "$p" ]; } || exit 1
    done
  ' sh {} +
  find . -print > "$work/paths"
  LC_ALL=C sort "$work/paths" > "$work/sorted"
  while IFS= read -r p; do
    metadata=$(stat -c '%a:%u:%g' "$p")
    if [ -d "$p" ]; then
      printf 'd %s %s\n' "$metadata" "$p"
    else
      digest=$(sha256sum < "$p"); digest=${digest%% *}
      size=$(wc -c < "$p" | tr -d ' ')
      printf 'f %s %s %s %s\n' "$metadata" "$digest" "$size" "$p"
    fi
  done < "$work/sorted" > "$output"
)

persistence_extract() (
  set -eu
  archive=$1; destination=$2
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  tar -tzf "$archive" > "$work/paths"
  while IFS= read -r p; do
    case "$p" in .|./|./*) :;; *) exit 1;; esac
    case "$p" in /*|../*|*/../*|*/..|./.rsp-restore-*|./.rsp-previous-*) exit 1;; esac
  done < "$work/paths"
  # Reject symlinks, hardlinks and special files BEFORE extraction.
  tar -tvzf "$archive" > "$work/types"
  if LC_ALL=C grep -q '^[^-d]' "$work/types"; then exit 1; fi
  tar -xzf "$archive" -C "$destination"
)
