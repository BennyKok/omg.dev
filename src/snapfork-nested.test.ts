// A base installs every nested bun project (apps/landing, templates/*,
// mobile/), so forks share those node_modules through the lower layer instead
// of each writing its own copy. On 2026-11-05, 20.6 GB of 21.9 GB in fork
// layers was such copies. A fork re-installs a nested project only when its
// own commit changed that project's lockfile or manifest.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildBase,
  createSnapfork,
  nestedBunProjects,
  overlayBinary,
  removeSnapforkLayer,
  snapforkSupport,
  unmountSnapfork,
} from "./snapfork.ts";

const sh = (cwd: string, cmd: string[]) => {
  const r = Bun.spawnSync({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};
const git = (cwd: string, ...args: string[]) =>
  sh(cwd, ["git", "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args]);

// A bun project with one local dependency, so `bun install --frozen-lockfile`
// works offline and leaves node_modules/<dep>.
function bunProject(dir: string, dep: string): void {
  mkdirSync(join(dir, "deps", dep), { recursive: true });
  writeFileSync(join(dir, "deps", dep, "package.json"), JSON.stringify({ name: dep, version: "1.0.0" }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: `p-${dep}`, private: true, dependencies: { [dep]: `file:./deps/${dep}` } }),
  );
  sh(dir, ["bun", "install"]);
  rmSync(join(dir, "node_modules"), { recursive: true, force: true });
}

let root = "";
let repo = "";
let sha = "";
const scope = process.env.LFG_SNAPFORK_SCOPE;

beforeAll(() => {
  process.env.LFG_SNAPFORK_SCOPE = "0";
  root = mkdtempSync(join(tmpdir(), "lfg-snapfork-nested-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  bunProject(repo, "rootdep");
  for (const dir of ["app", "templates/t1", "templates/t1/fixture"]) {
    mkdirSync(join(repo, dir), { recursive: true });
    bunProject(join(repo, dir), dir.replaceAll("/", "-"));
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  sha = git(repo, "rev-parse", "HEAD");
});

afterAll(async () => {
  await unmountSnapfork("s1", join(root, "wt")).catch(() => false);
  await removeSnapforkLayer("s1", join(root, "wt")).catch(() => undefined);
  if (scope === undefined) delete process.env.LFG_SNAPFORK_SCOPE;
  else process.env.LFG_SNAPFORK_SCOPE = scope;
  rmSync(root, { recursive: true, force: true });
});

describe("nestedBunProjects", () => {
  test("keeps nested project folders and skips the root, fixtures, tests and node_modules", () => {
    expect(
      nestedBunProjects([
        "bun.lock",
        "mobile/bun.lock",
        "apps/landing/bun.lock",
        "templates/android-builder/fixture/bun.lock",
        "tests/app/bun.lock",
        "x/node_modules/y/bun.lock",
        "apps/infra/worker/package-lock.json",
      ]),
    ).toEqual(["apps/landing", "mobile"]);
  });
});

describe("buildBase", () => {
  test("installs nested bun projects in the base, but not fixtures", async () => {
    const base = await buildBase(repo, sha, join(root, "wt"));
    expect(base).not.toBeNull();
    const p = base!.path;
    expect(existsSync(join(p, "node_modules", "rootdep"))).toBe(true);
    expect(existsSync(join(p, "app", "node_modules", "app"))).toBe(true);
    expect(existsSync(join(p, "templates", "t1", "node_modules", "templates-t1"))).toBe(true);
    expect(existsSync(join(p, "templates", "t1", "fixture", "node_modules"))).toBe(false);
  });
});

const supported = snapforkSupport().supported && overlayBinary() !== null;

describe.skipIf(!supported)("createSnapfork", () => {
  test("shares unchanged nested installs and re-installs only a changed one", async () => {
    // The session commit swaps app's dependency; templates/t1 is untouched.
    bunProject(join(repo, "app"), "app2");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "bump app dep");
    const wtRoot = join(root, "wt");
    const wtPath = join(wtRoot, "s1");
    const r = await createSnapfork({ repo, name: "s1", branch: "session_s1", ref: "HEAD", wtPath, root: wtRoot });
    expect(r.kind).toBe("snapfork");

    expect(existsSync(join(wtPath, "app", "node_modules", "app2", "package.json"))).toBe(true);
    const upper = join(wtRoot, ".snapfork", "layers", "s1", "upper");
    expect(existsSync(join(upper, "app", "node_modules"))).toBe(true);
    // Seen through the mount, but not copied into the session's layer.
    expect(existsSync(join(wtPath, "templates", "t1", "node_modules", "templates-t1"))).toBe(true);
    expect(existsSync(join(upper, "templates", "t1", "node_modules"))).toBe(false);
    expect(lstatSync(join(upper, ".git")).isFile()).toBe(true);
  });
});
