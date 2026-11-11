#!/usr/bin/env bash
# Runs the `preflight` step of .github/workflows/deploy-production.yml against a fake `gh` that
# returns controlled API answers (CMP: compare status or "404"; RUN: successful CI run id or "";
# JOB: deploy-staging conclusion or ""). Each case passes except the one input under test.
#   scripts/test-deploy-production-preflight.sh                  run the cases ("RED" = wrong result)
#   scripts/test-deploy-production-preflight.sh --step           print the extracted step (to mutate it)
#   scripts/test-deploy-production-preflight.sh --run STEP_FILE  run the cases on a (mutated) step
set -u
wf=$(cd "$(dirname "$0")/.." && pwd)/.github/workflows/deploy-production.yml
here=$(mktemp -d); trap 'rm -rf "$here"' EXIT
step=$here/step.sh
python - "$wf" "$step" <<'EOF'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r'        run: \|\n((?:          .*\n|\n)+?)\n  deploy:', s)
open(sys.argv[2], 'w', newline='\n').write('\n'.join(l[10:] for l in m.group(1).splitlines()) + '\n')
EOF
case "${1:-}" in
  --step) cat "$step"; exit 0 ;;
  --run) step=$2 ;;
esac
mkdir -p "$here/bin"
cat > "$here/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$2" in
  */compare/*) [ "$CMP" = 404 ] && { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }; echo "$CMP" ;;
  */actions/workflows/ci.yml/runs*) echo "$RUN" ;;
  */jobs*) echo "$JOB" ;;
  *) echo "fake gh: unexpected $*" >&2; exit 3 ;;
esac
EOF
chmod +x "$here/bin/gh"
G=0123456789abcdef0123456789abcdef01234567
t() { # NAME EXPECT(pass|refuse) SHA CMP RUN JOB
  local out rc got
  out=$(PATH="$here/bin:$PATH" SHA=$3 REPO=o/r CMP=$4 RUN=$5 JOB=$6 bash "$step" 2>&1); rc=$?
  [ $rc = 0 ] && got=pass || got=refuse
  printf '%-6s %-34s expect=%-6s got=%-6s | %s\n' "$([ "$got" = "$2" ] && echo ok || echo RED)" "$1" "$2" "$got" "$(tail -1 <<<"$out")"
}
t "all prerequisites, main ahead"      pass   $G ahead     42 success
t "all prerequisites, main identical"  pass   $G identical 42 success
t "SHA not on main (diverged)"         refuse $G diverged  42 success
t "SHA not on main (behind)"           refuse $G behind    42 success
t "unknown commit (404)"               refuse $G 404       42 success
t "no green CI run of the push"        refuse $G ahead     ""  success
t "deploy-staging failed"              refuse $G ahead     42  failure
t "deploy-staging absent"              refuse $G ahead     42  ""
t "input not 40 hex"                   refuse "${G:0:39}"  ahead 42 success
t "input upper case"                   refuse "${G^^}"     ahead 42 success
