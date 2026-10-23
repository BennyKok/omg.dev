#!/usr/bin/env bash
#
# Build the local main checkout for scripts/land-session.sh without ever
# leaving the live web UI broken.
#
#   scripts/land-build.sh <main-checkout>
#
# land-session.sh runs this under run_in_build_scope (below) while it holds the
# repository landing lock. The file is also sourced, by land-session.sh and by
# scripts/land-build.test.ts, for its functions.
#
# Why it exists (2026-10-22): agents run land-session.sh from inside
# lfg.service, whose cgroup has MemoryMax=16G and sits near 13.5G with every
# agent and shell in it. The kernel OOM-killed `vite build` twice (exit 137).
# Vite had already emptied web/dist, which the running server reads on every
# request, so the UI returned 500 for about 15 minutes. Two fixes:
#
# 1. The build runs in its own transient systemd scope with its own memory
#    limit, outside lfg.service's cgroup.
# 2. The web bundle is built into a staging directory next to web/dist and
#    renamed over it only after the build succeeds and is complete. A failed
#    or killed build leaves the old web/dist in place, still served.

set -euo pipefail

die() {
  printf '[x] %s\n' "$*" >&2
  exit 1
}

say() {
  printf '==> %s\n' "$*"
}

# A web build that emits index.html but loses its asset chunks still leaves a
# checkout that looks deployable: the service starts, `/` answers 200, and the
# deployed-head marker would certify the revision as live while every visitor
# gets a blank page. That has happened (an interrupted/concurrent `vite build`
# left web/dist/assets empty), so refuse a dist whose own entry document points
# at files that are not on disk.
assert_web_bundle_complete() {
  local dist="$1"
  local index="$dist/index.html"
  [ -f "$index" ] || die "web build produced no $index"

  local missing=0 ref
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    [ -f "$dist/$ref" ] || {
      printf '[x] missing build output: %s/%s\n' "$dist" "$ref" >&2
      missing=1
    }
  done < <(grep -oE '(src|href)="/[^"?#]+"' "$index" | sed -E 's/^[a-z]+="\/(.*)"$/\1/' | sort -u)

  [ "$missing" = "0" ] \
    || die "$dist is incomplete; rerun the web build (a concurrent or interrupted build can empty its assets)"
}

# The files under assets/ that one build emitted itself, one relative path per
# line. Carried-over files are not listed, so carrying stays one generation
# deep instead of accumulating every bundle ever built.
ASSET_MANIFEST=".build-assets"

write_asset_manifest() {
  local dist="$1"
  if [ -d "$dist/assets" ]; then
    (cd "$dist/assets" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) >"$dist/$ASSET_MANIFEST"
  else
    : >"$dist/$ASSET_MANIFEST"
  fi
}

# A tab that loaded the previous index.html still lazy-loads that build's
# hashed chunks. Keep the previous build's own assets next to the new ones so
# those requests do not 404 the moment the bundle swaps. Hashed names cannot
# collide with different content, and a name the new build also emits wins.
carry_previous_assets() {
  local old="$1" new="$2"
  [ -d "$old/assets" ] || return 0

  local list
  if [ -f "$old/$ASSET_MANIFEST" ]; then
    list="$(cat "$old/$ASSET_MANIFEST")"
  else
    # A dist built before the manifest existed: carry what it has, once.
    list="$(cd "$old/assets" && find . -type f | sed 's|^\./||')"
  fi

  local rel src dst
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    case "$rel" in /* | *..*) continue ;; esac
    src="$old/assets/$rel"
    dst="$new/assets/$rel"
    [ -f "$src" ] || continue
    [ -e "$dst" ] && continue
    mkdir -p "$(dirname "$dst")"
    # A hard link costs no space and survives removal of the old directory.
    ln "$src" "$dst" 2>/dev/null || cp -p "$src" "$dst"
  done <<<"$list"
}

# Put a finished staging directory in place of the live one. GNU mv 9.5+ can
# exchange the two directories in one renameat2(RENAME_EXCHANGE) call, so there
# is no instant without a bundle. Elsewhere (macOS, older coreutils) fall back
# to two renames, which leave a window of microseconds instead of the whole
# build.
swap_web_dist() {
  local staging="$1" live="$2"
  local old
  if [ ! -e "$live" ]; then
    mv "$staging" "$live"
    return 0
  fi
  if mv -T --exchange "$staging" "$live" 2>/dev/null; then
    old="$staging"
  else
    old="$live.old.$$"
    mv "$live" "$old"
    mv "$staging" "$live"
  fi
  rm -rf "$old"
}

# Run a web build command into a fresh staging directory, then swap it in.
#
#   build_web_dist <web-dir> <command...>
#
# The command runs in <web-dir> with LFG_WEB_OUT_DIR set to the staging path
# (web/vite.config.ts reads it). On any failure the live <web-dir>/dist is not
# touched and the staging directory is removed.
build_web_dist() {
  local web_dir="$1"
  shift
  local live="$web_dir/dist"
  local staging="$web_dir/.dist-next.$$"

  # Leftovers from a build that was SIGKILLed before its cleanup ran. The
  # landing lock is held, so no other landing owns them.
  rm -rf "$web_dir"/.dist-next.* "$web_dir"/dist.old.*

  local status=0
  (cd "$web_dir" && LFG_WEB_OUT_DIR="$staging" "$@") || status=$?
  if [ "$status" != "0" ]; then
    rm -rf "$staging"
    die "web build failed (exit $status); $live was left unchanged"
  fi

  # die exits a subshell only, so check the result instead of trusting it.
  if ! (assert_web_bundle_complete "$staging"); then
    rm -rf "$staging"
    die "web build output is incomplete; $live was left unchanged"
  fi

  write_asset_manifest "$staging"
  carry_previous_assets "$live" "$staging"
  swap_web_dist "$staging" "$live"
  say "Swapped the new web bundle into $live"
}

build_main_checkout() {
  local main_root="$1"
  (cd "$main_root" && bun install --frozen-lockfile)
  (cd "$main_root/web" && bun install --frozen-lockfile)
  # The web workspace resolves @omg-dev/* through each package's generated
  # dist entrypoint. Rebuild those entrypoints first so a transport/protocol
  # source change cannot make the web build consume stale declarations.
  # These dist directories feed the web build only. The running server does
  # not read them, so their own `rm -rf dist` cannot break the live UI.
  (cd "$main_root" && bun run --cwd packages/protocol build)
  (cd "$main_root" && bun run --cwd packages/client build)
  (cd "$main_root" && bun run --cwd packages/react build)
  build_web_dist "$main_root/web" bun run build
}

# Run a command in its own transient systemd user scope with its own memory
# limit. Agents call land-session.sh from inside lfg.service, so without this
# the build competes for that unit's MemoryMax with every running agent.
#
# systemd-run reports "could not start the scope" with the same non-zero exit
# as a failed command, so probe once with `true` first. Without systemd (macOS,
# CI containers, no user bus) the command runs directly.
#
#   LFG_LAND_BUILD_SCOPE=0           run directly, no scope
#   LFG_LAND_BUILD_MEMORY_MAX=4G     the scope's memory limit
run_in_build_scope() {
  local memory_max="${LFG_LAND_BUILD_MEMORY_MAX:-4G}"
  local -a scope=(systemd-run --user --scope --quiet -p "MemoryMax=$memory_max" -p MemorySwapMax=0)
  if [ "${LFG_LAND_BUILD_SCOPE:-1}" != "0" ] \
    && command -v systemd-run >/dev/null 2>&1 \
    && "${scope[@]}" true >/dev/null 2>&1; then
    say "Building in a transient systemd scope (MemoryMax=$memory_max)"
    "${scope[@]}" "$@"
  else
    say "systemd-run scope unavailable; building in the current process group"
    "$@"
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  [ $# -eq 1 ] || die "usage: $0 <main-checkout>"
  build_main_checkout "$1"
fi
