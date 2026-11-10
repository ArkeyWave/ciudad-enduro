#!/usr/bin/env bash
# Refuses an image that ships test code or a leaked secret.
#
#   verify-image.sh <image> [canary]
#
# 1. Path check: no file under /app (outside node_modules) may match the forbidden pattern.
# 2. Canary check (when a canary is given): CI writes CANARY_<random> into apps/api/.env
#    before the build; the string must not appear in any layer or config of `docker save`.
set -euo pipefail

image=${1:?usage: verify-image.sh <image> [canary]}
canary=${2:-}
forbidden='test/support|capture-mailer|e2e-main|auth\.cli|\.spec\.|\.e2e\.'

paths=$(docker run --rm --entrypoint find "$image" /app -name node_modules -prune -o -print)
if [ -z "$paths" ]; then
  echo "FAIL $image: /app is empty or missing" >&2
  exit 1
fi
if hits=$(grep -E "$forbidden" <<<"$paths"); then
  echo "FAIL $image: forbidden paths in /app:" >&2
  echo "$hits" >&2
  exit 1
fi
echo "ok   $image: no forbidden paths ($(wc -l <<<"$paths") entries)"

[ -z "$canary" ] && exit 0
case "$canary" in CANARY_?*) ;; *) echo "FAIL canary must look like CANARY_<random>" >&2; exit 1 ;; esac

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
docker save "$image" | tar -x -C "$dir"
found=0
while IFS= read -r -d '' f; do
  # Raw bytes catch configs and uncompressed layers; tar -xO catches compressed layers
  # (GNU tar detects gzip/zstd when reading a file).
  if grep -qaF "$canary" "$f" || { tar -tf "$f" >/dev/null 2>&1 && tar -xOf "$f" 2>/dev/null | grep -qaF "$canary"; }; then
    echo "FAIL $image: canary found in ${f#"$dir"/}" >&2
    found=1
  fi
done < <(find "$dir" -type f -print0)
[ "$found" -eq 0 ] || exit 1
echo "ok   $image: canary absent from every layer"
