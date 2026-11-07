import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { createProjectFolder, prepareProjectFolder, useProjectFolder } from "./repos-store.ts";
import {
  prepareSessionWorktree,
  resolveSessionCwd,
  shouldAutoWorktree,
  WORKTREE_ROOT,
} from "./worktree.ts";

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return result.stdout.toString().trim();
}

describe("project creation", () => {
  const originalData = PATHS.data;
  const roots: string[] = [];
  const worktreeSessions: Array<{ repo: string; session: string }> = [];

  afterEach(() => {
    PATHS.data = originalData;
    for (const { repo, session } of worktreeSessions.splice(0)) {
      Bun.spawnSync(["git", "-C", repo, "worktree", "remove", "--force", join(WORKTREE_ROOT, session)]);
      Bun.spawnSync(["git", "-C", repo, "branch", "-D", `session_${session}`]);
    }
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("creates a committed main branch that can back an isolated session worktree", async () => {
    const root = mkdtempSync(join(tmpdir(), "lfg-project-create-"));
    roots.push(root);
    PATHS.data = join(root, "data");

    const repo = await createProjectFolder(root, "test");

    expect(git(repo.cwd, "branch", "--show-current")).toBe("main");
    expect(git(repo.cwd, "show", "HEAD:README.md")).toBe("# test");
    // A plain project: no template, no hosted builder skill, no agent files.
    expect(git(repo.cwd, "ls-files")).toBe("README.md");
    expect(git(repo.cwd, "status", "--short")).toBe("");
    expect(JSON.parse(readFileSync(join(PATHS.data, "custom-repos.json"), "utf8"))).toEqual([
      { name: "test", cwd: repo.cwd },
    ]);

    const session = `repo-init-${crypto.randomUUID().slice(0, 8)}`;
    worktreeSessions.push({ repo: repo.cwd, session });
    const worktree = await prepareSessionWorktree(repo.cwd, session);

    expect(worktree.ok).toBe(true);
    if (!worktree.ok) return;
    expect(git(worktree.worktree.path, "rev-parse", "HEAD")).toBe(git(repo.cwd, "rev-parse", "HEAD"));
  });

    test("a new project gets a local git identity only when the machine has none", async () => {
  const saved = { home: process.env.HOME, nosystem: process.env.GIT_CONFIG_NOSYSTEM, global: process.env.GIT_CONFIG_GLOBAL };
  const home = mkdtempSync(join(tmpdir(), "lfg-noident-"));
  const root = mkdtempSync(join(tmpdir(), "lfg-project-ident-"));
  roots.push(root);
  PATHS.data = join(root, "data");
  try {
    process.env.HOME = home;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.env.GIT_CONFIG_GLOBAL = join(home, "empty-gitconfig");
    const bare = await createProjectFolder(root, "No Identity");
    expect(git(bare.cwd, "config", "--local", "user.email")).toBe("agent@omg.dev");

    writeFileSync(join(home, "empty-gitconfig"), "[user]\n\tname = Real Person\n\temail = real@example.com\n");
    const owned = await createProjectFolder(root, "Has Identity");
    expect(Bun.spawnSync(["git", "-C", owned.cwd, "config", "--local", "user.email"], { env: { ...process.env } }).exitCode).not.toBe(0);
    const effective = Bun.spawnSync(["git", "-C", owned.cwd, "config", "user.email"], { env: { ...process.env } });
    expect(effective.stdout.toString().trim()).toBe("real@example.com");
  } finally {
    for (const [key, value] of [["HOME", saved.home], ["GIT_CONFIG_NOSYSTEM", saved.nosystem], ["GIT_CONFIG_GLOBAL", saved.global]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

  test("isolates LFG's own repository instead of honoring the old self-repo skip", async () => {
    const root = mkdtempSync(join(tmpdir(), "lfg-self-worktree-"));
    roots.push(root);
    git(root, "init", "-b", "main");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    writeFileSync(join(root, "README.md"), "self repo\n");
    git(root, "add", "README.md");
    git(root, "commit", "-m", "initial");

    expect(await shouldAutoWorktree(root, { selfRepo: root })).toBe(true);
    expect(await shouldAutoWorktree(root, { selfRepo: root, worktree: false })).toBe(true);
    const session = `self-${crypto.randomUUID().slice(0, 8)}`;
    worktreeSessions.push({ repo: root, session });
    const resolved = await resolveSessionCwd(root, session, { selfRepo: root });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.cwd).toBe(join(WORKTREE_ROOT, session));
    expect(resolved.worktree?.repoRoot).toBe(root);
  });

  test("removes the project directory when registration fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "lfg-project-rollback-"));
    roots.push(root);
    PATHS.data = join(root, "blocked-data");
    writeFileSync(PATHS.data, "not a directory");

    await expect(createProjectFolder(root, "test")).rejects.toThrow();

    expect(existsSync(join(root, "test"))).toBe(false);
  });

  test("launches the first session in an existing folder before it has a commit", async () => {
    const root = mkdtempSync(join(tmpdir(), "lfg-project-existing-"));
    roots.push(root);
    PATHS.data = join(root, "data");
    const folder = join(root, "existing");
    mkdirSync(folder);
    writeFileSync(join(folder, "notes.txt"), "keep me\n");

    const repo = await useProjectFolder(folder);
    expect(Bun.spawnSync(["git", "-C", repo.cwd, "rev-parse", "HEAD"]).exitCode).not.toBe(0);

    const resolved = await resolveSessionCwd(repo.cwd, `unborn-${crypto.randomUUID().slice(0, 8)}`);
    expect(resolved).toEqual({ ok: true, cwd: repo.cwd });
    expect(readFileSync(join(folder, "notes.txt"), "utf8")).toBe("keep me\n");
  });

  test("accepts an existing folder without changing its files or Git history", async () => {
    const root = mkdtempSync(join(tmpdir(), "lfg-project-prepare-"));
    roots.push(root);
    const folder = join(root, "existing");
    mkdirSync(folder);
    writeFileSync(join(folder, "notes.txt"), "keep me\n");

    expect(await prepareProjectFolder(folder)).toBe(folder);
    expect(readFileSync(join(folder, "notes.txt"), "utf8")).toBe("keep me\n");
    expect(existsSync(join(folder, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(folder, ".git"))).toBe(false);
  });
});
