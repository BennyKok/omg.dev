#!/usr/bin/env bash
#
# Build the public OMG packages and, unless --build-only is passed, pack
# release-ready tarballs.
#
# Internal workspace dependencies are rewritten to the EXACT published version,
# not a range: the four packages are versioned in lockstep off the root
# package.json and share wire types, so a consumer that resolved
# @omg-dev/client 0.1.5 against @omg-dev/protocol 0.1.9 would typecheck and then
# disagree at runtime. Exact pinning makes a release one indivisible set.
#
# These used to be rewritten to immutable GitHub release asset URLs, because the
# packages were not on npm. They are now published to the public registry under
# @omg-dev, so a plain semver dependency resolves for everyone.
# @omg-dev/cli is packed after these four and keeps its own version.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="$ROOT/dist"
VERSION="$(bun -e 'console.log(JSON.parse(require("node:fs").readFileSync("package.json","utf8")).version)')"
PACKAGES=(protocol client react)

if [ "${SKIP_PACKAGE_BUILD:-}" != "1" ]; then
  for package in "${PACKAGES[@]}"; do
    bun run --cwd "packages/$package" build
  done
  bun run --cwd web build:lib
  bun run --cwd packages/cli build
fi

if [ "${1:-}" = "--build-only" ]; then
  exit 0
fi

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/omg-dev-*.tgz
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/omg-packages.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

for package in "${PACKAGES[@]}"; do
  package_stage="$STAGE/$package"
  mkdir -p "$package_stage"
  cp -r "packages/$package/dist" "$package_stage/dist"
  cp "packages/$package/package.json" "$package_stage/package.json"
  cp LICENSE "$package_stage/LICENSE"

  MANIFEST="$package_stage/package.json" \
  VERSION="$VERSION" \
  bun -e '
const fs = require("node:fs");
const manifest = process.env.MANIFEST;
const version = process.env.VERSION;
const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
json.version = version;
for (const section of ["dependencies", "optionalDependencies"]) {
  for (const [name, value] of Object.entries(json[section] || {})) {
    if (!name.startsWith("@omg-dev/") || value !== "workspace:*") continue;
    json[section][name] = version;
  }
}
delete json.scripts;
delete json.devDependencies;
fs.writeFileSync(manifest, JSON.stringify(json, null, 2) + "\n");
'

  npm pack "$package_stage" --pack-destination "$OUT_DIR" --silent
done

app_stage="$STAGE/app"
mkdir -p "$app_stage"
cp -r web/dist-lib "$app_stage/dist-lib"
cp web/package.json "$app_stage/package.json"
cp LICENSE "$app_stage/LICENSE"

MANIFEST="$app_stage/package.json" \
VERSION="$VERSION" \
bun -e '
const fs = require("node:fs");
const manifest = process.env.MANIFEST;
const version = process.env.VERSION;
const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
json.version = version;
for (const section of ["dependencies", "optionalDependencies"]) {
  for (const [name, value] of Object.entries(json[section] || {})) {
    if (!name.startsWith("@omg-dev/") || value !== "workspace:*") continue;
    json[section][name] = version;
  }
}
delete json.scripts;
delete json.devDependencies;
fs.writeFileSync(manifest, JSON.stringify(json, null, 2) + "\n");
'

npm pack "$app_stage" --pack-destination "$OUT_DIR" --silent

# @omg-dev/cli is versioned independently. The runtime packages follow the
# repository tag (0.2.x). npm latest for this name is the retired vibes
# prompt-to-app CLI at 0.4.42, so this bootstrapper must pack its own 0.5.0+
# number or `bun install --global @omg-dev/cli` would keep resolving 0.4.42.
cli_stage="$STAGE/cli"
mkdir -p "$cli_stage"
cp -r packages/cli/dist "$cli_stage/dist"
cp packages/cli/package.json "$cli_stage/package.json"
cp packages/cli/README.md "$cli_stage/README.md"
cp LICENSE "$cli_stage/LICENSE"

MANIFEST="$cli_stage/package.json" bun -e '
const fs = require("node:fs");
const json = JSON.parse(fs.readFileSync(process.env.MANIFEST, "utf8"));
delete json.scripts;
delete json.devDependencies;
fs.writeFileSync(process.env.MANIFEST, JSON.stringify(json, null, 2) + "\n");
'

npm pack "$cli_stage" --pack-destination "$OUT_DIR" --silent
