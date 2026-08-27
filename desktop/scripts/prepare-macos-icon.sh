#!/usr/bin/env bash

set -euo pipefail

DESKTOP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_ROOT/.." && pwd)"
SOURCE_ICON="$REPO_ROOT/mobile/assets/icon.png"
ICONSET="$DESKTOP_ROOT/icon.iconset"

command -v sips >/dev/null 2>&1 || {
  echo "prepare-macos-icon.sh requires the macOS sips command." >&2
  exit 1
}

[ -f "$SOURCE_ICON" ] || {
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
}

mkdir -p "$ICONSET"

while read -r pixels filename; do
  sips -z "$pixels" "$pixels" "$SOURCE_ICON" \
    --out "$ICONSET/$filename" >/dev/null
done <<'SIZES'
16 icon_16x16.png
32 icon_16x16@2x.png
32 icon_32x32.png
64 icon_32x32@2x.png
128 icon_128x128.png
256 icon_128x128@2x.png
256 icon_256x256.png
512 icon_256x256@2x.png
512 icon_512x512.png
1024 icon_512x512@2x.png
SIZES

echo "Prepared macOS icon set: $ICONSET"
