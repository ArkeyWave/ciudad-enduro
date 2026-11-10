#!/usr/bin/env bash
# Refuses an image that ships test code, assistant files or a leaked secret.
#
#   verify-image.sh <image> [canary]
#
# 1. Path check: no file under /app (outside node_modules) may match the forbidden pattern.
# 2. Canary check (when a canary is given): CI writes CANARY_<random> into apps/api/.env
#    before the build; the string must not appear in any layer or config of `docker save`.
# Any error while reading the image fails the check (fail closed).
#
# The staging box runs a reviewed copy of this file (/usr/local/lib/ce-oss/verify-image.sh);
# a change here needs a new install there (docs/operations/deploy.md).
set -euo pipefail

image=${1:?usage: verify-image.sh <image> [canary]}
canary=${2:-}
forbidden='test/support|capture-mailer|e2e-main|auth\.cli|\.spec\.|\.e2e\.|\.test\.'
forbidden+='|(^|/)(CLAUDE\.md|CLAUDE\.local\.md|AGENTS\.md|\.claude|\.codex|\.cursor|\.gstack|\.playwright-mcp|\.t3)(/|$)'

fail() { echo "FAIL $image: $*" >&2; exit 1; }

paths=$(docker run --rm --entrypoint find "$image" /app -name node_modules -prune -o -print) ||
  fail "cannot list /app"
[ -n "$paths" ] || fail "/app is empty or missing"
rc=0; hits=$(grep -E "$forbidden" <<<"$paths") || rc=$?
case $rc in
  0) fail "forbidden paths in /app:"$'\n'"$hits" ;;
  1) ;;
  *) fail "path check error (grep exit $rc)" ;;
esac
echo "ok   $image: no forbidden paths ($(wc -l <<<"$paths") entries)"

[ -z "$canary" ] && exit 0
[[ $canary =~ ^CANARY_[A-Za-z0-9]+$ ]] || fail "canary must look like CANARY_<random>"

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
docker save "$image" | tar -x -C "$dir" || fail "docker save or tar extraction failed"

# found → 0, not found → 1, read error → exit. grep reads the whole stream (no -q), so an
# early match cannot SIGPIPE the decompressor into a false "not found".
contains() { # file
  local f=$1 magic dec rc
  rc=0; grep -aF -- "$canary" "$f" >/dev/null || rc=$?
  [ "$rc" -le 1 ] || fail "grep error on ${f#"$dir"/}"
  [ "$rc" -eq 0 ] && return 0
  magic=$(head -c 4 "$f" | od -An -tx1 | tr -d ' \n')
  case $magic in
    1f8b*) dec=gzip ;;
    28b52ffd) dec=zstd ;;
    *) return 1 ;;
  esac
  "$dec" -dc -- "$f" | grep -aF -- "$canary" >/dev/null
  local st=("${PIPESTATUS[@]}")
  [ "${st[0]}" -eq 0 ] || fail "$dec could not decompress ${f#"$dir"/}"
  case ${st[1]} in 0) return 0 ;; 1) return 1 ;; *) fail "grep error on ${f#"$dir"/}" ;; esac
}

found=0; files=0
while IFS= read -r -d '' f; do
  files=$((files + 1))
  if contains "$f"; then
    echo "FAIL $image: canary found in ${f#"$dir"/}" >&2
    found=1
  fi
done < <(find "$dir" -type f -print0)
[ "$files" -gt 0 ] || fail "docker save produced no files"
[ "$found" -eq 0 ] || exit 1
echo "ok   $image: canary absent from all $files files of docker save"
