#!/usr/bin/env bash
# Run scripts/sync-bench.ts on a fresh omg sandbox (the "omg" template), against
# a branch of this repository, then delete the sandbox.
#
#   OMG_API_KEY=omg_sk_... scripts/sync-bench-sandbox.sh [branch] [runs]
#
# OMG_BASE_URL defaults to https://infra.omg.dev. The branch must be pushed to
# github.com/BennyKok/omg.dev. Prints one JSON result per run. The key is sent
# only as an Authorization header and is never printed.
set -euo pipefail
: "${OMG_API_KEY:?set OMG_API_KEY to an omg_sk_ key}"
BASE="${OMG_BASE_URL:-https://infra.omg.dev}"
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
RUNS="${2:-3}"
H=(-H "Authorization: Bearer $OMG_API_KEY" -H 'Content-Type: application/json')

created=$(curl -fsS -m 480 -X POST "$BASE/v1/sandboxes" "${H[@]}" \
  -d "{\"template\":\"omg\",\"idempotencyKey\":\"sync-bench-$(date +%s)-$$\"}")
ID=$(printf '%s' "$created" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "sandbox $ID" >&2
trap 'curl -fsS -o /dev/null -X DELETE "$BASE/v1/sandboxes/$ID" "${H[@]}" && echo "deleted $ID" >&2' EXIT

run() { # $1 = shell command, $2 = timeout ms
  local body
  body=$(python3 -I -c 'import json,sys; print(json.dumps({"cmd":"/bin/bash","args":["-lc",sys.argv[1]],"timeoutMs":int(sys.argv[2])}))' "$1" "$2")
  curl -fsS -m $(( $2 / 1000 + 30 )) -X POST "$BASE/v1/sandboxes/$ID/exec" "${H[@]}" -d "$body" |
    python3 -I -c 'import json,sys; d=json.load(sys.stdin); sys.stdout.write(d.get("stdout","")); sys.stderr.write(d.get("stderr","")); sys.exit(d.get("exitCode") or 0)'
}

run "set -e; cd ~; git clone -q --depth 1 -b '$BRANCH' https://github.com/BennyKok/omg.dev omg-bench; cd omg-bench; bun install --frozen-lockfile >/tmp/install.log 2>&1 || { tail -20 /tmp/install.log; exit 1; }; (cd packages/protocol && bun run build >/dev/null); (cd packages/client && bun run build >/dev/null)" 600000 >&2
for i in $(seq 1 "$RUNS"); do
  run "cd ~/omg-bench && env -u OMG_PORT -u LFG_PORT -u OMG_HOST -u LFG_HOST bun scripts/sync-bench.ts --spawn --iterations 20 --idle-seconds 10 --json 2>/dev/null" 400000
done
