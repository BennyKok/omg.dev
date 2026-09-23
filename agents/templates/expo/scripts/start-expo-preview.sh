#!/usr/bin/env bash
# Start the one Metro server for Expo Web and Expo Go behind the omg.dev
# sandbox proxy, then prove it works.
#
#   bash scripts/start-expo-preview.sh <expoGo.proxyUrl> [port]
#
# Get <expoGo.proxyUrl> from omg_expose_port({ port, expoGo: true }). The script
# replaces an earlier Metro on the same port, detaches the new one so it
# outlives the shell tool, waits until it answers, builds the iOS and web
# bundles once so the first phone open is fast, and checks the proxy. It exits
# non-zero with the Metro log tail when any step fails. Allow it 4 minutes.
set -euo pipefail

PROXY_URL="${1:?usage: bash scripts/start-expo-preview.sh <expoGo.proxyUrl> [port]}"
PORT="${2:-8081}"
PROXY_URL="${PROXY_URL%/}"
cd "$(dirname "$0")/.."
LOG="${TMPDIR:-/tmp}/expo-preview-${PORT}.log"
LOCAL="http://127.0.0.1:${PORT}"
EXPO=./node_modules/.bin/expo

fail() {
  echo "FAILED: $*" >&2
  [ -f "$LOG" ] && { echo "--- last lines of $LOG ---" >&2; tail -n 30 "$LOG" >&2; }
  exit 1
}
up() { curl -fsS -m 3 "$LOCAL/status" 2>/dev/null | grep -q "packager-status:running"; }

[ -x "$EXPO" ] || bun install >/dev/null || fail "bun install failed"

# One Metro per port. `ss` is not installed on every Computer, so probe with curl.
if up; then
  pkill -f "expo start .*--port ${PORT}" || true
  for _ in $(seq 1 40); do up || break; sleep 0.5; done
  up && fail "another Metro still answers on port ${PORT}"
fi

# setsid + nohup: the agent's shell tool kills its process group on timeout.
: >"$LOG"
BROWSER=none EXPO_PACKAGER_PROXY_URL="$PROXY_URL" \
  setsid nohup "$EXPO" start --go --web --host lan --port "$PORT" >>"$LOG" 2>&1 </dev/null &
METRO_PID=$!

for _ in $(seq 1 90); do
  up && break
  kill -0 "$METRO_PID" 2>/dev/null || fail "Metro exited during start"
  sleep 1
done
up || fail "Metro did not answer on port ${PORT} within 90 seconds"

# Build the exact iOS bundle Expo Go will request. The manifest names it with
# the proxy origin, so fetch it through localhost instead.
manifest=$(curl -fsS -m 30 -H "expo-platform: ios" -H "Accept: application/expo+json,application/json" "$LOCAL/") \
  || fail "Metro did not return an Expo Go manifest"
ios_path=$(printf '%s' "$manifest" | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const u = new URL(JSON.parse(s).launchAsset.url); console.log(u.pathname + u.search);
  })') || fail "the manifest has no launch bundle"
start=$SECONDS
curl -fsS -m 200 -o /dev/null "$LOCAL$ios_path" || fail "the iOS bundle did not build"
echo "iOS bundle ready in $((SECONDS - start))s"

web_path=$(curl -fsS -m 30 "$LOCAL/" | grep -o 'src="/[^"]*\.bundle[^"]*"' | head -n 1 | sed 's/^src="//; s/"$//; s/&amp;/\&/g' || true)
if [ -n "$web_path" ]; then
  start=$SECONDS
  curl -fsS -m 200 -o /dev/null "$LOCAL$web_path" || fail "the web bundle did not build"
  echo "Web bundle ready in $((SECONDS - start))s"
fi

code=$(curl -sS -m 60 -o /dev/null -w '%{http_code}' -H "expo-platform: ios" \
  -H "Accept: application/expo+json,application/json" "$PROXY_URL/" || true)
[ "$code" = 200 ] || fail "the sandbox proxy returned HTTP ${code} for the Expo Go manifest"

echo "Metro running on port ${PORT} (pid ${METRO_PID}, log ${LOG})"
echo "Sandbox proxy answers: HTTP 200"
echo "Expo Go link: exps://${PROXY_URL#https://}"
