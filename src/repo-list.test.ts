import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRepoList } from "./repo-list.ts";

function gitRepo(parent: string, name: string): string {
  const cwd = join(parent, name);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "README.md"), `# ${name}\n`);
  const init = Bun.spawnSync(["git", "-C", cwd, "init", "-b", "main"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(init.exitCode, init.stderr.toString()).toBe(0);
  return cwd;
}

describe("buildRepoList", () => {
  const originalRoot = process.env.LFG_REPOS_ROOT;
  const sandboxes: string[] = [];
  let root = "";
  let reposRoot = "";
  let selfRepo = "";

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "lfg-repo-list-")));
    sandboxes.push(root);
    reposRoot = join(root, "repos");
    mkdirSync(reposRoot, { recursive: true });
    // projectName() derives its label relative to the configured repos root.
    process.env.LFG_REPOS_ROOT = reposRoot;
    selfRepo = gitRepo(root, "lfg-install");
  });

  afterEach(() => {
    if (originalRoot === undefined) delete process.env.LFG_REPOS_ROOT;
    else process.env.LFG_REPOS_ROOT = originalRoot;
    for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const build = (over: Partial<Parameters<typeof buildRepoList>[0]> = {}) =>
    buildRepoList({ reposRoot, selfRepo, customRepos: [], hidden: [], ...over });

  test("lists git checkouts under the repos root plus the self repo", async () => {
    gitRepo(reposRoot, "alpha");
    gitRepo(reposRoot, "beta");
    // Not a git checkout — a stray directory is not a project.
    mkdirSync(join(reposRoot, "notes"), { recursive: true });

    const repos = await build();

    expect(repos.map((r) => r.name)).toEqual(["alpha", "beta", "lfg"]);
  });

  test("drops a hidden scanned repo", async () => {
    const alpha = gitRepo(reposRoot, "alpha");
    gitRepo(reposRoot, "beta");

    const repos = await build({ hidden: [alpha] });

    // The regression this whole feature exists for: before the hidden list,
    // there was no way to take a scanned repo off the picker at all.
    expect(repos.map((r) => r.name)).toEqual(["beta", "lfg"]);
  });

  test("drops a hidden custom pin", async () => {
    const outside = gitRepo(root, "outside");

    const repos = await build({
      customRepos: [{ name: "outside", cwd: outside }],
      hidden: [outside],
    });

    expect(repos.map((r) => r.name)).toEqual(["lfg"]);
  });

  test("can hide the self repo without emptying the list", async () => {
    gitRepo(reposRoot, "alpha");

    const repos = await build({ hidden: [selfRepo] });

    expect(repos.map((r) => r.name)).toEqual(["alpha"]);
  });

  test("a custom pin wins a project-name collision against the scan", async () => {
    gitRepo(reposRoot, "duet");
    const pinned = gitRepo(join(root, "work"), "duet");

    const repos = await build({ customRepos: [{ name: "duet", cwd: pinned }] });

    // Both derive the project name "duet" and only one row survives. The pinned
    // path is the one the user chose by hand, so it must be the survivor — it
    // used to lose silently, with the pin written to disk and never rendered.
    const duet = repos.find((r) => r.project === "duet");
    expect(duet?.cwd).toBe(pinned);
    expect(duet?.custom).toBe(true);
  });

  test("tags a pinned path that is also inside the repos root as custom", async () => {
    const inside = gitRepo(reposRoot, "alpha");

    const repos = await build({ customRepos: [{ name: "alpha", cwd: inside }] });

    // One row, and it carries `custom` so the UI can say it was pinned. The
    // dedupe is on cwd, so the scan hit for the same path is absorbed.
    expect(repos.filter((r) => r.cwd === inside)).toHaveLength(1);
    expect(repos.find((r) => r.cwd === inside)?.custom).toBe(true);
  });

  test("survives a missing repos root", async () => {
    const repos = await build({ reposRoot: join(root, "does-not-exist") });

    expect(repos.map((r) => r.name)).toEqual(["lfg"]);
  });
});
