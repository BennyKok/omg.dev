#!/usr/bin/env bash

set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$DESKTOP_DIR/.." && pwd)"
RUNTIME_DIR="$DESKTOP_DIR/embedded-runtime"
RUNTIME_ARCHIVE="$DESKTOP_DIR/embedded-runtime.tar.gz"

case "$(uname -s)" in
  Darwin) TARGET_OS=darwin ;;
  Linux) TARGET_OS=linux ;;
  *) echo "Unsupported desktop build host: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64|aarch64) TARGET_CPU=arm64 ;;
  x86_64|amd64) TARGET_CPU=x64 ;;
  *) echo "Unsupported desktop build architecture: $(uname -m)" >&2; exit 1 ;;
esac

cd "$ROOT"
bun run --cwd packages/protocol build
bun run --cwd packages/client build
bun run --cwd web build

rm -rf "$RUNTIME_DIR"
rm -f "$RUNTIME_ARCHIVE" "$RUNTIME_ARCHIVE.sha256"
mkdir -p "$RUNTIME_DIR/web"
cp -R \
  src agents scripts package.json bun.lock .env.example \
  README.md CHANGELOG.md LICENSE SECURITY.md \
  "$RUNTIME_DIR/"
cp -R web/dist "$RUNTIME_DIR/web/dist"
find "$RUNTIME_DIR/web/dist" -name '*.map' -delete
find "$RUNTIME_DIR/src" "$RUNTIME_DIR/scripts" -name '*.test.ts' -delete

bun run scripts/prepare-release-manifest.ts "$RUNTIME_DIR/package.json"
(
  cd "$RUNTIME_DIR"
  unset CI
  bun install --production --frozen-lockfile --os="$TARGET_OS" --cpu="$TARGET_CPU"
)

bun run scripts/prune-modules.ts \
  --root "$RUNTIME_DIR/node_modules" \
  --os "$TARGET_OS" \
  --cpu "$TARGET_CPU" \
  --libc glibc \
  --drop-agent-runtimes \
  --quiet

test -s "$RUNTIME_DIR/src/cli.ts"
test -s "$RUNTIME_DIR/web/dist/index.html"
test -d "$RUNTIME_DIR/node_modules"

tar -C "$RUNTIME_DIR" -czf "$RUNTIME_ARCHIVE" .
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$RUNTIME_ARCHIVE" | awk '{print $1}' > "$RUNTIME_ARCHIVE.sha256"
else
  shasum -a 256 "$RUNTIME_ARCHIVE" | awk '{print $1}' > "$RUNTIME_ARCHIVE.sha256"
fi

echo "Embedded runtime ready for $TARGET_OS/$TARGET_CPU ($(du -sh "$RUNTIME_DIR" | cut -f1) unpacked, $(du -h "$RUNTIME_ARCHIVE" | cut -f1) packaged)."
