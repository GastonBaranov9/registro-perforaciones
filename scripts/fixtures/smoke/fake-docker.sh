#!/bin/sh
set -eu
if [ "${1:-}" = inspect ];then
  printf '{}\n'
  exit 0
fi
last=
for value in "$@";do last=$value;done
case "$last" in api|front|postgres) printf '%s-id\n' "$last";; *) exit 2;;esac
