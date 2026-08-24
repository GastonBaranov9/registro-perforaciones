#!/bin/sh
set -eu

secret_file_validate(){
  [ -f "$1" ] && [ ! -L "$1" ] || { echo "Archivo secreto invalido" >&2;return 1; }
  size=$(wc -c < "$1"|tr -d ' ');[ "$size" -le 4096 ]||{ echo "Archivo secreto demasiado grande" >&2;return 1; }
}

secret_file_copy_without_one_eol(){
  secret_file_validate "$1";umask 077
  size=$(wc -c < "$1"|tr -d ' ');keep=$size
  if [ "$size" -ge 2 ]&&[ "$(tail -c 2 "$1"|od -An -tx1|tr -d ' \n')" = 0d0a ];then keep=$((size-2))
  elif [ "$size" -ge 1 ]&&[ "$(tail -c 1 "$1"|od -An -tx1|tr -d ' \n')" = 0a ];then keep=$((size-1));fi
  dd if="$1" of="$2" bs=1 count="$keep" 2>/dev/null
}

secret_file_write_login_json() (
  secret_file_validate "$1"
  trimmed="$3.secret.$$";trap 'rm -f "$trimmed"' EXIT HUP INT TERM
  secret_file_copy_without_one_eol "$1" "$trimmed"
  jq -n --arg email "$2" --rawfile password "$trimmed" '{email:$email,password:$password}' > "$3"
)
