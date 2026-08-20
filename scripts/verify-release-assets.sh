#!/usr/bin/env bash
# Verify a GitHub Release carries every asset the release workflow staged,
# re-upload anything missing, and fail loudly if the release stays incomplete.
#
#   scripts/verify-release-assets.sh <tag> [dist-dir]
#
# Why this exists: v0.1.360 died mid-upload during a GitHub 500s window — the
# publish step confirmed 13 of 16 assets and the log simply stopped. The red
# run was the only signal, and nobody was watching it. fail_on_unmatched_files
# only proves each glob matched a local file at upload time; nothing asserted
# the uploads arrived. This script is that assertion.
#
# The expected set is the publish step's `files:` list expanded against the
# staging directory, so it tracks whatever release.sh actually produced. Keep
# the patterns in sync with .github/workflows/release.yml. Platform bundles
# can be legitimately absent — release.sh skips a platform whose cross-install
# fails, and setup.sh falls back to the neutral bundle — so they are checked
# when staged, never demanded. The neutral bundles and the five @omg-dev
# packages are unconditional build products and are demanded outright.
#
# Env:
#   REPO     - owner/name, defaults to $GITHUB_REPOSITORY, then BennyKok/omg.dev
#   REPAIR=0 - verify only, never re-upload (dry runs and tests)
#   VERIFY_SLEEP_S - retry backoff ceiling in seconds (tests set this to 0)
set -euo pipefail

backoff() { sleep "${VERIFY_SLEEP_S:-$1}"; }

tag="${1:?usage: verify-release-assets.sh <tag> [dist-dir]}"
dist="${2:-dist}"
repo="${REPO:-${GITHUB_REPOSITORY:-BennyKok/omg.dev}}"

say() { printf '%s\n' "$*"; }
err() { printf '::error::%s\n' "$*" >&2; }

shopt -s nullglob

# Mirrors the publish step's `files:` list in release.yml.
staged=(
  "$dist"/omg-bundle.tar.gz
  "$dist"/omg-bundle.tar.gz.sha256
  "$dist"/lfg-bundle.tar.gz
  "$dist"/lfg-bundle.tar.gz.sha256
  "$dist"/omg-*-*.tar.gz
  "$dist"/omg-*-*.tar.gz.sha256
  "$dist"/omg-dev-protocol-*.tgz
  "$dist"/omg-dev-client-*.tgz
  "$dist"/omg-dev-react-*.tgz
  "$dist"/omg-dev-app-*.tgz
  "$dist"/omg-dev-cli-*.tgz
)

if ((${#staged[@]} == 0)); then
  err "no staged assets found in $dist — did the bundle step run?"
  exit 1
fi

# Unconditional build products: even a perfectly-uploaded release is broken
# without these, so demand they were staged before checking the remote.
core_ok=1
for pat in \
  "$dist"/omg-bundle.tar.gz "$dist"/omg-bundle.tar.gz.sha256 \
  "$dist"/lfg-bundle.tar.gz "$dist"/lfg-bundle.tar.gz.sha256 \
  "$dist"/omg-dev-protocol-*.tgz "$dist"/omg-dev-client-*.tgz \
  "$dist"/omg-dev-react-*.tgz "$dist"/omg-dev-app-*.tgz \
  "$dist"/omg-dev-cli-*.tgz; do
  if ! compgen -G "$pat" >/dev/null; then
    err "core asset $pat was never staged"
    core_ok=0
  fi
done
((core_ok == 1)) || exit 1

# Prints the release's assets as "name<TAB>size" lines. Retried: the release
# was just created and the API can lag or 5xx (the exact flakiness that
# caused v0.1.360).
fetch_assets() {
  local out attempt
  for attempt in 1 2 3 4 5; do
    if out="$(gh release view "$tag" --repo "$repo" --json assets \
      --jq '.assets[] | .name + "\t" + (.size | tostring)' 2>/dev/null)" && [ -n "$out" ]; then
      printf '%s\n' "$out"
      return 0
    fi
    say "release $tag not readable yet (attempt $attempt/5), retrying..." >&2
    backoff $((attempt * 4))
  done
  return 1
}

asset_size() { # <name> -> size or empty
  printf '%s\n' "$assets" | awk -F'\t' -v n="$1" '$1 == n { print $2 }'
}

# Compares the staged set against $assets. Echoes "name<TAB>reason<TAB>path"
# for every staged file that is missing, empty, or the wrong size.
find_bad() {
  local f name remote_sz local_sz
  for f in "${staged[@]}"; do
    [ -f "$f" ] || continue # absent literal names were reported by the core check
    name="$(basename "$f")"
    remote_sz="$(asset_size "$name")"
    local_sz="$(stat -c %s "$f")"
    if [ -z "$remote_sz" ]; then
      printf '%s\tmissing\t%s\n' "$name" "$f"
    elif [ "$remote_sz" = "0" ]; then
      printf '%s\tzero-size on the release\t%s\n' "$name" "$f"
    elif [ "$remote_sz" != "$local_sz" ]; then
      printf '%s\tsize mismatch (release: %s, staged: %s)\t%s\n' "$name" "$remote_sz" "$local_sz" "$f"
    fi
  done
}

assets="$(fetch_assets)" || {
  err "release $tag not found or has no assets"
  exit 1
}

bad="$(find_bad)"

if [ -n "$bad" ] && [ "${REPAIR:-1}" != "0" ]; then
  # Transient upload failures are the common case (v0.1.360 hit a GitHub 500s
  # window), so re-upload the stragglers once before declaring the release
  # broken. Repair is not a substitute for the check below: anything still
  # missing after re-upload fails the job.
  say "release $tag is incomplete, re-uploading:"
  say "$bad"
  mapfile -t reupload < <(printf '%s\n' "$bad" | cut -f3-)
  uploaded=0
  for attempt in 1 2 3; do
    if gh release upload "$tag" --repo "$repo" --clobber -- "${reupload[@]}"; then
      uploaded=1
      break
    fi
    say "re-upload failed (attempt $attempt/3), retrying..." >&2
    backoff $((attempt * 5))
  done
  if ((uploaded == 1)); then
    assets="$(fetch_assets)" || {
      err "release $tag unreadable after re-upload"
      exit 1
    }
    bad="$(find_bad)"
  fi
fi

if [ -n "$bad" ]; then
  while IFS=$'\t' read -r name reason _; do
    err "release $tag: $name — $reason"
  done <<<"$bad"
  err "release $tag is INCOMPLETE — $(printf '%s\n' "$bad" | wc -l) of ${#staged[@]} staged assets did not arrive"
  exit 1
fi

say "release $tag verified: all ${#staged[@]} staged assets present with matching sizes"
