#!/bin/sh
set -eu
case "$*" in
  *to_regclass*) printf '%s\n' "${TEST_DB_LEDGER:-present}";;
  *)
    old_ifs=$IFS;IFS=,
    for id in ${TEST_DB_REFS:-};do [ -n "$id" ]&&printf '%s\n' "$id";done
    IFS=$old_ifs
    ;;
esac
