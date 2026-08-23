import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { EMBED_TEST_BUILDS, TEST_BUILDS } from "./test-builds";

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

  test("EMBED_TEST_BUILDS adds it on top of the package builds", () => {
    expect(EMBED_TEST_BUILDS.map((b) => b.output)).toContain("web/dist-lib/index.js");
    // It must keep the package builds ahead of it; dist-lib imports the client.
    expect(EMBED_TEST_BUILDS.length).toBe(TEST_BUILDS.length + 1);
    expect(EMBED_TEST_BUILDS.slice(0, TEST_BUILDS.length)).toEqual(TEST_BUILDS as never);
  });
});

describe("the embed smoke stays runnable and stays wired up", () => {
  const SMOKE = "web/src/embedded-lib-smoke.release-check.ts";

  test("the smoke file exists under a name bun test does not discover", () => {
    expect(existsSync(join(ROOT, SMOKE))).toBe(true);
    // bun test discovers .test./.spec. only. If someone renames this back, the
    // 1.7 GB build silently returns to every local test run.
    expect(/\.(test|spec)\./.test(SMOKE)).toBe(false);
  });

  test("test:embed builds with --with-embed and names the file as a path", () => {
    const script = JSON.parse(read("package.json")).scripts["test:embed"] as string;
    expect(script).toContain("--with-embed");
    // "./" matters: a bare filter that matches nothing exits 0, which would
    // make a broken release check look green.
    expect(script).toContain(`bun test ./${SMOKE}`);
  });

  test("the release workflow runs it after the packages are built", () => {
    const yml = read(".github/workflows/release.yml");
    expect(yml).toContain("bun run test:embed");
    expect(yml.indexOf("bun run build:packages")).toBeLessThan(yml.indexOf("bun run test:embed"));
  });

  test("the web tsconfig excludes release-check files", () => {
    // It imports ../dist-lib and bun:test; neither resolves in the app program.
    expect(read("web/tsconfig.json")).toContain("src/**/*.release-check.ts");
  });
});

describe("vite runtime split", () => {
  test("dev runs under bun, builds stay on node", () => {
    const scripts = JSON.parse(read("web/package.json")).scripts as Record<string, string>;
    expect(scripts.dev).toBe("bun --bun vite");
    // Measured: bun builds are faster (26s vs 31s) but peak at 3.18 GB against
    // 1.72 GB. Memory is the constraint here, so the builds stay on node.
    expect(scripts.build).not.toContain("--bun");
    expect(scripts["build:lib"]).not.toContain("--bun");
  });
});
