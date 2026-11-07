import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { TEST_BUILDS } from "./test-builds";

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * `web/dist-lib/index.js` used to sit in TEST_BUILDS. It lists `web/src` as an
 * input, so any edit to the UI marked it stale and the next `bun run test`
 * rebuilt it — a vite build measured at 1.7 GB peak resident for ~30s. Several
 * worktrees testing at once is what took this box to load 44 at 24% iowait.
 *
 * The bundle still has to be proven before it ships, so it moved to an opt-in
 * script that the release workflow calls. These tests pin both halves: the
 * default path stays cheap, and the expensive check stays wired up.
 */
describe("the default test path does not build the embed bundle", () => {
  test("TEST_BUILDS carries no vite build", () => {
    const outputs = TEST_BUILDS.map((b) => b.output);
    expect(outputs).not.toContain("web/dist-lib/index.js");
    expect(outputs.every((o) => o.startsWith("packages/"))).toBe(true);
    // The real tell is the command, not the path: nothing here may invoke vite.
    expect(TEST_BUILDS.some((b) => b.build.includes("build:lib"))).toBe(false);
  });
});

// The @omg-dev/app library bundle was removed with the embedding mode: no
// script, workflow or package may build or publish it again.
describe("the library bundle is gone", () => {
  test("no build:lib, no test:embed, and the release does not publish @omg-dev/app", () => {
    expect(JSON.parse(read("web/package.json")).scripts["build:lib"]).toBeUndefined();
    expect(JSON.parse(read("package.json")).scripts["test:embed"]).toBeUndefined();
    const yml = read(".github/workflows/release.yml");
    expect(yml).not.toContain("test:embed");
    expect(yml).not.toContain("omg-dev-app");
    expect(read("scripts/pack-packages.sh")).not.toContain("build:lib");
    expect(existsSync(join(ROOT, "web/vite.lib.config.ts"))).toBe(false);
  });
});

describe("vite runtime split", () => {
  test("dev runs under bun, builds stay on node", () => {
    const scripts = JSON.parse(read("web/package.json")).scripts as Record<string, string>;
    expect(scripts.dev).toBe("bun --bun vite");
    // Measured: bun builds are faster (26s vs 31s) but peak at 3.18 GB against
    // 1.72 GB. Memory is the constraint here, so the builds stay on node.
    expect(scripts.build).not.toContain("--bun");
  });
});
