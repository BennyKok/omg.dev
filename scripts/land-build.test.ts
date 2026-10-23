import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercises the staged web build and the memory-scope wrapper from
// scripts/land-build.sh by sourcing it and handing build_web_dist a fake build
// command. No vite, no bun install, no systemd: the script cannot tell.

const SCRIPT = join(import.meta.dir, "land-build.sh");

let root: string;
let web: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "land-build-"));
  web = join(root, "web");
  mkdirSync(web, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(snippet: string, env: Record<string, string> = {}) {
  // $0 must not be the script path, or its run-as-main guard fires on source.
  const result = spawnSync("bash", ["-c", `. "$1"; shift; ${snippet}`, "land-build-test", SCRIPT, web], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

// A fake `vite build`: writes an index.html that loads assets/<name>.js into
// the directory land-build.sh hands it, then exits with `exit`.
function fakeBuild(name: string, opts: { exit?: number; skipAsset?: boolean } = {}) {
  const asset = opts.skipAsset ? "" : `printf 'chunk' >"$LFG_WEB_OUT_DIR/assets/${name}.js";`;
  return `bash -c 'mkdir -p "$LFG_WEB_OUT_DIR/assets"; ${asset} printf "<script src=\\"/assets/${name}.js\\"></script>" >"$LFG_WEB_OUT_DIR/index.html"; exit ${opts.exit ?? 0}'`;
}

function seedLiveDist(name: string) {
  mkdirSync(join(web, "dist", "assets"), { recursive: true });
  writeFileSync(join(web, "dist", "index.html"), `<script src="/assets/${name}.js"></script>`);
  writeFileSync(join(web, "dist", "assets", `${name}.js`), "old chunk");
}

function webEntries() {
  return readdirSync(web).sort();
}

describe("build_web_dist", () => {
  test("swaps a successful build in and keeps the previous build's chunks", () => {
    seedLiveDist("old-aaa");
    const { status, out } = run(`build_web_dist "$1" ${fakeBuild("new-bbb")}`);
    expect(out).toContain("Swapped the new web bundle");
    expect(status).toBe(0);

    const dist = join(web, "dist");
    expect(readFileSync(join(dist, "index.html"), "utf8")).toContain("new-bbb.js");
    expect(readFileSync(join(dist, "assets", "new-bbb.js"), "utf8")).toBe("chunk");
    // A tab still on the old index.html can load its chunk.
    expect(readFileSync(join(dist, "assets", "old-aaa.js"), "utf8")).toBe("old chunk");
    // The manifest lists only what this build emitted.
    expect(readFileSync(join(dist, ".build-assets"), "utf8").trim()).toBe("new-bbb.js");
    expect(webEntries()).toEqual(["dist"]);
  });

  test("carries the previous build only, not every build before it", () => {
    seedLiveDist("gen0");
    expect(run(`build_web_dist "$1" ${fakeBuild("gen1")}`).status).toBe(0);
    expect(run(`build_web_dist "$1" ${fakeBuild("gen2")}`).status).toBe(0);
    const assets = readdirSync(join(web, "dist", "assets")).sort();
    expect(assets).toEqual(["gen1.js", "gen2.js"]);
  });

  test("a killed build leaves the live bundle untouched and exits non-zero", () => {
    seedLiveDist("old-aaa");
    // 137 is what the OOM killer produced on 2026-10-22.
    const { status, out } = run(`build_web_dist "$1" ${fakeBuild("new-bbb", { exit: 137 })}`);
    expect(status).not.toBe(0);
    expect(out).toContain("web build failed (exit 137)");
    expect(readFileSync(join(web, "dist", "index.html"), "utf8")).toContain("old-aaa.js");
    expect(readdirSync(join(web, "dist", "assets"))).toEqual(["old-aaa.js"]);
    expect(webEntries()).toEqual(["dist"]);
  });

  test("an incomplete build is refused and the live bundle stays", () => {
    seedLiveDist("old-aaa");
    const { status, out } = run(`build_web_dist "$1" ${fakeBuild("new-bbb", { skipAsset: true })}`);
    expect(status).not.toBe(0);
    expect(out).toContain("missing build output");
    expect(readFileSync(join(web, "dist", "index.html"), "utf8")).toContain("old-aaa.js");
    expect(webEntries()).toEqual(["dist"]);
  });

  test("builds into place when no bundle exists yet", () => {
    expect(run(`build_web_dist "$1" ${fakeBuild("first")}`).status).toBe(0);
    expect(existsSync(join(web, "dist", "assets", "first.js"))).toBe(true);
  });

  test("removes staging leftovers from an earlier SIGKILLed build", () => {
    seedLiveDist("old-aaa");
    mkdirSync(join(web, ".dist-next.99999", "assets"), { recursive: true });
    mkdirSync(join(web, "dist.old.99998"), { recursive: true });
    expect(run(`build_web_dist "$1" ${fakeBuild("new-bbb")}`).status).toBe(0);
    expect(webEntries()).toEqual(["dist"]);
  });

  test("falls back to two renames when mv cannot exchange", () => {
    seedLiveDist("old-aaa");
    const bin = join(root, "bin");
    mkdirSync(bin);
    // A mv without --exchange, like macOS or coreutils before 9.5.
    const realMv = spawnSync("bash", ["-c", "command -v mv"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(
      join(bin, "mv"),
      `#!/usr/bin/env bash\nfor a in "$@"; do [ "$a" = "--exchange" ] && { echo "mv: unrecognized option '--exchange'" >&2; exit 1; }; done\nexec ${realMv} "$@"\n`,
    );
    chmodSync(join(bin, "mv"), 0o755);
    const { status } = run(`build_web_dist "$1" ${fakeBuild("new-bbb")}`, {
      PATH: `${bin}:${process.env.PATH}`,
    });
    expect(status).toBe(0);
    expect(readFileSync(join(web, "dist", "index.html"), "utf8")).toContain("new-bbb.js");
    expect(existsSync(join(web, "dist", "assets", "old-aaa.js"))).toBe(true);
    expect(webEntries()).toEqual(["dist"]);
  });
});

describe("run_in_build_scope", () => {
  function stubSystemdRun(body: string) {
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "systemd-run"), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, "systemd-run"), 0o755);
    return { PATH: `${bin}:${process.env.PATH}`, SCOPE_LOG: join(root, "scope.log") };
  }

  test("runs the command in a scope with the memory limit", () => {
    const env = stubSystemdRun(
      `echo "$*" >>"$SCOPE_LOG"; while [ "$1" != "true" ] && [ "$1" != "echo" ]; do shift; done; exec "$@"`,
    );
    const { status, out } = run(`run_in_build_scope echo built`, {
      ...env,
      LFG_LAND_BUILD_MEMORY_MAX: "3G",
    });
    expect(status).toBe(0);
    expect(out).toContain("built");
    const log = readFileSync(env.SCOPE_LOG, "utf8");
    expect(log).toContain("--user --scope --quiet -p MemoryMax=3G -p MemorySwapMax=0 echo built");
  });

  test("propagates a failed command's exit status through the scope", () => {
    const env = stubSystemdRun(`while [ "$1" != "true" ] && [ "$1" != "bash" ]; do shift; done; exec "$@"`);
    const { status } = run(`run_in_build_scope bash -c 'exit 137'`, env);
    expect(status).toBe(137);
  });

  test("runs directly when no scope can be started", () => {
    const env = stubSystemdRun(`echo "Failed to connect to bus" >&2; exit 1`);
    const { status, out } = run(`run_in_build_scope echo built`, env);
    expect(status).toBe(0);
    expect(out).toContain("scope unavailable");
    expect(out).toContain("built");
  });

  test("LFG_LAND_BUILD_SCOPE=0 skips systemd-run", () => {
    const env = stubSystemdRun(`echo "should not run" >>"$SCOPE_LOG"; exit 1`);
    const { status } = run(`run_in_build_scope echo built`, { ...env, LFG_LAND_BUILD_SCOPE: "0" });
    expect(status).toBe(0);
    expect(existsSync(env.SCOPE_LOG)).toBe(false);
  });
});
