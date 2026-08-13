import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercises scripts/verify-release-assets.sh against a stub `gh` on PATH that
// serves release state from a plain directory: `release view` lists the
// directory as name/size rows, `release upload` copies files into it. The
// script under test never sees the difference.

const SCRIPT = join(import.meta.dir, "verify-release-assets.sh");
const TAG = "v9.9.9";

const STUB = `#!/usr/bin/env bash
set -euo pipefail
store="\${GH_STUB_STORE:?}"
if [ "$1" = "release" ] && [ "$2" = "view" ]; then
  [ -d "$store" ] || exit 1
  for f in "$store"/*; do
    [ -e "$f" ] || continue
    printf '%s\\t%s\\n' "$(basename "$f")" "$(stat -c %s "$f")"
  done
  exit 0
fi
if [ "$1" = "release" ] && [ "$2" = "upload" ]; then
  mkdir -p "$store"
  shift 2
  while [ $# -gt 0 ]; do
    if [ "$1" = "--" ]; then shift; break; fi
    shift
  done
  cp "$@" "$store"/
  exit 0
fi
echo "stub gh: unexpected args: $*" >&2
exit 2
`;

// The full asset set a release ships when every platform bundle staged.
function assetNames(version: string): string[] {
  return [
    "omg-bundle.tar.gz",
    "omg-bundle.tar.gz.sha256",
    "lfg-bundle.tar.gz",
    "lfg-bundle.tar.gz.sha256",
    ...["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"].flatMap((p) => [
      `omg-${p}.tar.gz`,
      `omg-${p}.tar.gz.sha256`,
    ]),
    ...["protocol", "client", "react", "app"].map((p) => `omg-dev-${p}-${version}.tgz`),
  ];
}

let root: string;
let bin: string;
let dist: string;
let store: string;

function put(dir: string, name: string, size: number) {
  writeFileSync(join(dir, name), Buffer.alloc(size, 7));
}

function populate(dir: string, names: string[]) {
  mkdirSync(dir, { recursive: true });
  names.forEach((name, i) => put(dir, name, 1000 + i));
}

function run(extraEnv: Record<string, string> = {}) {
  const r = spawnSync("bash", [SCRIPT, TAG, dist], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      GH_STUB_STORE: store,
      VERIFY_SLEEP_S: "0",
      ...extraEnv,
    },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, errout: r.stderr };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "verify-release-"));
  bin = join(root, "bin");
  dist = join(root, "dist");
  store = join(root, "store");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), STUB, { mode: 0o755 });
  populate(dist, assetNames(TAG));
  populate(store, assetNames(TAG));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("verify-release-assets.sh", () => {
  test("passes when every staged asset is on the release with matching size", () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain("all 16 staged assets present");
  });

  test("verify-only mode fails and names assets missing from the release", () => {
    rmSync(join(store, "omg-dev-react-v9.9.9.tgz"));
    rmSync(join(store, "omg-linux-arm64.tar.gz.sha256"));
    const r = run({ REPAIR: "0" });
    expect(r.code).toBe(1);
    expect(r.errout).toContain("omg-dev-react-v9.9.9.tgz — missing");
    expect(r.errout).toContain("omg-linux-arm64.tar.gz.sha256 — missing");
    expect(r.errout).toContain("INCOMPLETE");
    expect(existsSync(join(store, "omg-dev-react-v9.9.9.tgz"))).toBe(false);
  });

  test("repairs a partial release by re-uploading the missing assets", () => {
    rmSync(join(store, "omg-dev-react-v9.9.9.tgz"));
    const r = run();
    expect(r.code).toBe(0);
    expect(existsSync(join(store, "omg-dev-react-v9.9.9.tgz"))).toBe(true);
  });

  test("treats a zero-size asset as broken and repairs it", () => {
    put(store, "omg-bundle.tar.gz.sha256", 0);
    const r = run({ REPAIR: "0" });
    expect(r.code).toBe(1);
    expect(r.errout).toContain("omg-bundle.tar.gz.sha256 — zero-size on the release");
    const repaired = run();
    expect(repaired.code).toBe(0);
  });

  test("fails on a size mismatch between the release and the staged file", () => {
    put(store, "lfg-bundle.tar.gz", 5);
    const r = run({ REPAIR: "0" });
    expect(r.code).toBe(1);
    expect(r.errout).toContain("lfg-bundle.tar.gz — size mismatch");
  });

  test("fails when a core asset was never staged", () => {
    rmSync(join(dist, "omg-bundle.tar.gz"));
    const r = run({ REPAIR: "0" });
    expect(r.code).toBe(1);
    expect(r.errout).toContain("core asset");
  });

  test("fails when the release does not exist", () => {
    rmSync(store, { recursive: true, force: true });
    const r = run({ REPAIR: "0" });
    expect(r.code).toBe(1);
    expect(r.errout).toContain("not found or has no assets");
  });

  test("does not demand platform bundles that were never staged", () => {
    // release.sh skips a platform whose cross-install fails; setup.sh then
    // falls back to the neutral bundle. A survivable skip must stay green.
    for (const name of assetNames(TAG).filter((n) => n.includes("darwin"))) {
      rmSync(join(dist, name));
      rmSync(join(store, name));
    }
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain("all 12 staged assets present");
  });
});
