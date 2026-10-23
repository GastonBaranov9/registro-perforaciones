#!/bin/sh
# Extract only the preflight helper; Docker never reaches the daemon.
set -eu
repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
eval "$(tr -d '\r' < "$repo/ops/deploy.sh" | awk '/^runtime_image\(\)/{copy=1} copy{print} copy && /^}/{exit}')"
expected=$(printf 'sha256:%064d' 0)
other=$(printf 'sha256:%064d' 1)
docker(){
  case "$*" in
    "image inspect --format {{.Id}} fixture-$service:full-sha")
      case "$scenario" in
        missing-image) return 1;;
        failed-image-with-output) echo "$expected";return 1;;
        malformed-image) echo sha256:short;return;;
      esac
      echo "$expected";;
    "inspect --format {{.Image}} $service-id")
      case "$scenario" in
        different-content) echo "$other";return;;
        inspect-failed) echo "$expected";return 1;;
        empty-runtime) return;;
      esac
      echo "$expected";;
    *) echo 'Forbidden Docker operation' >&2;return 99;;
  esac
}
count=0
for service in api front;do
  for scenario in alias-same-content different-content missing-image failed-image-with-output malformed-image inspect-failed empty-runtime;do
    if actual=$(runtime_image "$service-id" "fixture-$service:full-sha" 2>/dev/null);then failed=false;else failed=true;fi
    if [ "$scenario" = alias-same-content ];then
      [ "$failed" = false ] && [ "$actual" = "$expected" ] || exit 1
    else [ "$failed" = true ] || { echo "Accepted invalid identity: $service/$scenario";exit 1; };fi
    count=$((count+1))
  done
done
echo "IMAGE_IDENTITY_SH_OK $count/14; no real Docker commands"
