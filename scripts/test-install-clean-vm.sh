#!/usr/bin/env bash
# Run README.md's quick start on a genuinely clean machine and report what a
# new user would see.
#
#   scripts/test-install-clean-vm.sh [--keep] [--user NAME] [--port PORT]
#                                    [--cli-dist DIR]
#
# Why this exists: the quick start is the one code path every new user runs,
# and it is the one path no test covered. It is not testable from a developer
# box — every machine we own already has Bun, Node, an ~/omg install, or all
# three, and each of those hides a different failure.
#
# The documented first-run is this repository's setup.sh. The npm package
# @omg-dev/cli 0.4.x is the retired vibes CLI and must not be the path under
# test. --cli-dist DIR overlays a locally built @omg-dev/cli 0.5.0+ dist on
# top of a global install so the npm bootstrapper can be proven before publish.
#
# So this rents a fresh Firecracker VM from the OMG sandbox API, runs the
# documented commands as an ordinary sudo-capable user, and asserts the finish
# line a user cares about: setup exits 0, `serve` listens, and the web UI
# answers 200 with real HTML. The VM is destroyed afterwards unless --keep is
# passed.
#
# Requirements:
#   VIBES_INFRA_SERVICE_TOKEN  - infra service token (or _CI variant via ENVF)
#   INFRA_URL                  - defaults to https://infra.omg.dev
#   ENVF                       - optional env file to source for the above
#
# Exit codes:
#   0  the quick start works on a clean machine
#   1  it does not — the failing step and its output are printed
#   2  the harness could not run (bad env, no capacity)
set -euo pipefail

KEEP=0
VM_USER=tester
PORT=8766
CLI_DIST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    --user) VM_USER="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --cli-dist) CLI_DIST="$2"; shift 2 ;;
    -h|--help) sed -n '2,37p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -n "$CLI_DIST" ]]; then
  [[ -f "$CLI_DIST/omg.mjs" && -f "$CLI_DIST/omg-bun.mjs" ]] \
    || { echo "--cli-dist $CLI_DIST does not look like a built cli dist/" >&2; exit 2; }
fi

if [[ -n "${ENVF:-}" && -f "${ENVF}" ]]; then
  set -a; . "$ENVF"; set +a
fi

INFRA_URL="${INFRA_URL:-https://infra.omg.dev}"
TOKEN="${VIBES_INFRA_SERVICE_TOKEN:-${VIBES_INFRA_SERVICE_TOKEN_CI:-}}"
ON_BEHALF="${SMOKE_USER:-svc:omg-install-test}"
: "${TOKEN:?VIBES_INFRA_SERVICE_TOKEN required (or set ENVF to a file providing it)}"

command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

api() {
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "$INFRA_URL$path" \
      -H "Authorization: Bearer $TOKEN" -H "X-On-Behalf-Of: $ON_BEHALF" \
      -H 'Content-Type: application/json' --data "$body"
  else
    curl -sS -X "$method" "$INFRA_URL$path" \
      -H "Authorization: Bearer $TOKEN" -H "X-On-Behalf-Of: $ON_BEHALF"
  fi
}

SANDBOX=""
cleanup() {
  [[ -z "$SANDBOX" ]] && return
  if [[ "$KEEP" == 1 ]]; then
    log "keeping sandbox $SANDBOX (--keep)"
    return
  fi
  log "destroying sandbox $SANDBOX"
  api DELETE "/v1/sandboxes/$SANDBOX" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Run a script inside the VM as root. Prints stdout; returns the guest's exit
# code so a failing step here fails the harness.
vm() {
  local script="$1" timeout_ms="${2:-900000}"
  local body resp
  body="$(jq -nc --arg s "$script" --argjson t "$timeout_ms" \
    '{cmd:"bash",args:["-lc",$s],timeoutMs:$t}')"
  resp="$(api POST "/v1/sandboxes/$SANDBOX/exec" "$body")"
  printf '%s' "$resp" | jq -r '.stdout // ""'
  local stderr code
  stderr="$(printf '%s' "$resp" | jq -r '.stderr // ""')"
  code="$(printf '%s' "$resp" | jq -r '.exitCode // 1')"
  [[ -n "$stderr" ]] && printf '%s\n' "$stderr" >&2
  return "$code"
}

# ---------------------------------------------------------------------------
# 1. A clean machine
# ---------------------------------------------------------------------------
log "creating a clean sandbox VM"
create="$(api POST /v1/sandboxes "$(printf '{"ports":[%d],"timeout":3600}' "$PORT")")"
SANDBOX="$(printf '%s' "$create" | jq -r '.id // empty')"
[[ -n "$SANDBOX" ]] || { printf '%s\n' "$create" >&2; echo "could not create a sandbox" >&2; exit 2; }
ok "sandbox $SANDBOX ($(printf '%s' "$create" | jq -r '.nodeId // "?"'))"

log "baseline: what this machine has before we touch it"
vm 'cat /etc/os-release | grep PRETTY_NAME; for b in bun node npm git tmux; do printf "%-6s %s\n" "$b" "$(command -v $b || echo "(absent)")"; done'

# An ordinary user, because setup deliberately refuses to run as root and a
# root-only test would never see that path.
log "creating an ordinary sudo-capable user: $VM_USER"
vm "
set -e
command -v sudo >/dev/null || { apt-get -qq update && DEBIAN_FRONTEND=noninteractive apt-get -qq install -y sudo; } >/dev/null 2>&1
id $VM_USER >/dev/null 2>&1 || useradd -m -s /bin/bash $VM_USER
printf '%s ALL=(ALL) NOPASSWD:ALL\n' $VM_USER > /etc/sudoers.d/$VM_USER
chmod 440 /etc/sudoers.d/$VM_USER
id $VM_USER
" 300000 >/dev/null
ok "user $VM_USER ready"

# ---------------------------------------------------------------------------
# 2. The documented quick start, verbatim
# ---------------------------------------------------------------------------

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
staging="$(mktemp -d)"
# Stage this checkout's setup.sh so the VM follows the README against the
# PR's installer, not whatever is currently on main.
jq -nc --rawfile c <(base64 -w0 "$ROOT/scripts/setup.sh") --arg p /tmp/setup.sh \
  '[{path:$p,content:$c}]' > "$staging/setup.json"
api POST "/v1/sandboxes/$SANDBOX/files" "@$staging/setup.json" >/dev/null \
  || fail "could not stage setup.sh in the VM"

# An unreleased @omg-dev/cli 0.5.0+ fix is applied on top of a global install
# in the same place the next npm publish would land it.
overlay=""
if [[ -n "$CLI_DIST" ]]; then
  log "overlaying local cli dist from $CLI_DIST"
  mkdir "$staging/dist" && cp "$CLI_DIST"/* "$staging/dist/"
  tar czf "$staging/cli-dist.tgz" -C "$staging" dist
  jq -nc --rawfile c <(base64 -w0 "$staging/cli-dist.tgz") --arg p /tmp/cli-dist.tgz \
    '[{path:$p,content:$c}]' > "$staging/body.json"
  api POST "/v1/sandboxes/$SANDBOX/files" "@$staging/body.json" >/dev/null \
    || fail "could not stage the local dist in the VM"
  overlay="tar xzf /tmp/cli-dist.tgz -C \"\$HOME/.bun/install/global/node_modules/@omg-dev/cli\" --overwrite"
  ok "local dist staged in the VM"
fi

log "running README.md's quick start as $VM_USER"
if [[ -n "$CLI_DIST" ]]; then
  inner_install="bun install --global @omg-dev/cli
echo \"INSTALL_EXIT=\$?\"
$overlay
omg computer setup"
else
  inner_install="bash /tmp/setup.sh"
fi
vm "
cat > /home/$VM_USER/quickstart.sh <<INNER
#!/usr/bin/env bash
set -x
export PATH=\"\$HOME/.bun/bin:\$PATH\"
export OMG_INSTALL_SYSTEM_DEPS=1
export OMG_PORT=$PORT
$inner_install
echo \"SETUP_EXIT=\$?\"
echo '=== QUICKSTART DONE ==='
INNER
chown $VM_USER:$VM_USER /home/$VM_USER/quickstart.sh
chmod +x /home/$VM_USER/quickstart.sh
su - $VM_USER -c 'setsid nohup /home/$VM_USER/quickstart.sh > /home/$VM_USER/quickstart.log 2>&1 < /dev/null & disown'
" 300000 >/dev/null

# The bundle download dominates; poll rather than guess a sleep.
for _ in $(seq 1 60); do
  if vm "grep -q 'QUICKSTART DONE' /home/$VM_USER/quickstart.log" 120000 >/dev/null 2>&1; then break; fi
  sleep 5
done

setup_exit="$(vm "grep -oE 'SETUP_EXIT=[0-9]+' /home/$VM_USER/quickstart.log | tail -1 | cut -d= -f2" 120000 || echo "")"
if [[ "$setup_exit" != "0" ]]; then
  printf '\n--- quickstart.log (tail) ---\n' >&2
  vm "tail -40 /home/$VM_USER/quickstart.log" 120000 >&2 || true
  fail "the documented quick start failed on a clean machine (setup exit ${setup_exit:-unknown})"
fi
ok "omg computer setup exited 0"

# ---------------------------------------------------------------------------
# 3. The finish line: it actually serves
# ---------------------------------------------------------------------------
log "starting the install and checking the web UI"
vm "
su - $VM_USER -c 'setsid nohup bash -c \"cd \$HOME/omg && OMG_PORT=$PORT bun run \$HOME/omg/src/cli.ts serve\" > \$HOME/serve.log 2>&1 < /dev/null & disown'
" 120000 >/dev/null

served=0
for _ in $(seq 1 30); do
  if vm "curl -sf -o /tmp/ui.html http://127.0.0.1:$PORT/" 60000 >/dev/null 2>&1; then served=1; break; fi
  sleep 2
done
if [[ "$served" != 1 ]]; then
  printf '\n--- serve.log (tail) ---\n' >&2
  vm "tail -30 /home/$VM_USER/serve.log" 120000 >&2 || true
  fail "omg.dev installed but never answered on http://127.0.0.1:$PORT/"
fi

# 200 is necessary but not sufficient — assert the app actually rendered.
if ! vm "grep -q '<title>omg</title>' /tmp/ui.html" 60000 >/dev/null 2>&1; then
  fail "the web UI answered but did not serve the app shell"
fi
ok "web UI serves the app on http://127.0.0.1:$PORT/"

if ! vm "curl -sf http://127.0.0.1:$PORT/api/sessions | grep -q sessions" 60000 >/dev/null 2>&1; then
  fail "the API did not answer /api/sessions"
fi
ok "API answers /api/sessions"

printf '\n\033[1;32mThe documented quick start works on a clean machine.\033[0m\n'
