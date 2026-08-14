#!/bin/sh
set -eu
[ "$#" -eq 3 ]||exit 2
. "$1/ops/secret-file.sh"
secret_file_copy_without_one_eol "$2" "$3"
