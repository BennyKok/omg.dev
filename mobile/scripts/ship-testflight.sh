#!/usr/bin/env bash
#
# Build and ship this app to TestFlight in one go.
#
# Everything except Apple authentication is already wired, so this script is
# written to run UNATTENDED the moment credentials exist. It refuses to start
# rather than getting halfway and stopping at a prompt, because a half-finished
# iOS release leaves credentials and version numbers in a state someone then has
# to reason about.
#
# Preferred credentials — an App Store Connect API key. Set these and everything
# below is non-interactive, with no 2FA, forever:
#
#   export EXPO_ASC_API_KEY_PATH=/abs/path/AuthKey_XXXXXXXX.p8
#   export EXPO_ASC_KEY_ID=XXXXXXXX
#   export EXPO_ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#
# Create it at App Store Connect -> Users and Access -> Integrations ->
# App Store Connect API, with the App Manager role.
#
# Usage: ./scripts/ship-testflight.sh
set -euo pipefail

cd "$(dirname "$0")/.."

export EAS_BUILD_NO_EXPO_GO_WARNING=true
EAS="npx eas-cli@latest"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ── Preflight ───────────────────────────────────────────────────────────────
say "Preflight"

if [ -z "${EXPO_ASC_API_KEY_PATH:-}" ]; then
  cat >&2 <<'MSG'
No App Store Connect API key in the environment.

Without it eas-cli falls back to an interactive Apple login, and the session
cached on this box has expired — so this run would stop at a password prompt.

See docs/TESTFLIGHT.md. Set EXPO_ASC_API_KEY_PATH / EXPO_ASC_KEY_ID /
EXPO_ASC_ISSUER_ID and run this again.
MSG
  exit 1
fi

[ -f "$EXPO_ASC_API_KEY_PATH" ] || die "ASC key not found at $EXPO_ASC_API_KEY_PATH"
[ -n "${EXPO_ASC_KEY_ID:-}" ]    || die "EXPO_ASC_KEY_ID is not set"
[ -n "${EXPO_ASC_ISSUER_ID:-}" ] || die "EXPO_ASC_ISSUER_ID is not set"

BUNDLE=$(node -p "require('./app.json').expo.ios.bundleIdentifier")
NAME=$(node -p "require('./app.json').expo.name")
say "Shipping \"$NAME\" ($BUNDLE)"

# Catch anything that would break a device build before spending a build slot —
# unresolved imports, bad native module usage. Cheap, and it has already caught
# real breakage here.
say "Bundling for iOS (proves every import resolves)"
npx expo export --platform ios --output-dir /tmp/omg-ship-export >/dev/null
rm -rf /tmp/omg-ship-export
echo "  bundle ok"

say "Typecheck"
npx tsc --noEmit
echo "  types ok"

# ── Build ───────────────────────────────────────────────────────────────────
say "Building on EAS (this takes ~10-20 min)"
$EAS build --platform ios --profile production --non-interactive --wait

BUILD_ID=$($EAS build:list --platform ios --limit 1 --status finished --json --non-interactive \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s)[0];if(!b){process.exit(1)}process.stdout.write(b.id)})')

[ -n "$BUILD_ID" ] || die "Could not resolve a finished build id"
say "Built: $BUILD_ID"

# ── Submit ──────────────────────────────────────────────────────────────────
# Building is NOT shipping. `eas build` stops at an IPA on EAS servers; only
# `eas submit` reaches App Store Connect. Conflating the two has already cost
# this org days of a stale TestFlight while build:list happily said "finished".
say "Submitting to App Store Connect / TestFlight"
$EAS submit --platform ios --profile production --id "$BUILD_ID" --non-interactive

cat <<MSG

Submitted build $BUILD_ID.

App Store Connect still has to PROCESS it before it appears in TestFlight, which
usually takes 5-15 minutes and can fail after this script has already succeeded
(export compliance, missing icon, entitlement mismatch). Confirm it actually
landed in the TestFlight tab or in Apple's email before calling it shipped.
MSG
