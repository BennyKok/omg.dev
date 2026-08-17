// The worktree sweeper deletes directories, so every guard it has is a guard
// against destroying work. These tests pin the one that was missing.
//
// After a reboot, the sweeper deleted the worktrees of thirteen sessions that
// were alive and mid-task. Each one looked dead to every check the sweeper had:
// the tmux pane was gone (the reboot killed it), the managed row had been
// replaced by a resume under a new runtime name, and no process was sitting in
// the directory yet. All three signals describe *this instant*, so a session
// that a crash knocked over reads as garbage — and deleting its worktree is
// precisely what turns a recoverable session into an unrecoverable one.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { resetManagedRegistryForTests } from "./managed.ts";
import { resetResumeCacheConnectionForTests, upsertResumableRows } from "./resume-cache.ts";
import { sweepStaleWorktrees, WORKTREE_ROOT } from "./worktree.ts";

function git(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode, `git ${args.join(" ")}: ${r.stderr.toString()}`).toBe(0);
}

/** A committed, clean git worktree the sweeper is allowed to consider. */
function makeOwnedWorktree(name: string, parentRoot: string): string {
  const origin = join(parentRoot, "repo");
  mkdirSync(origin, { recursive: true });
  git(origin, "init", "-q", "-b", "main");
  git(origin, "config", "user.email", "test@example.com");
  git(origin, "config", "user.name", "test");
  writeFileSync(join(origin, "file.txt"), "committed\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-qm", "init");

  // The sweeper deletes with `git worktree remove`, so the fixture has to be a
  // real worktree of a parent repo rather than a standalone checkout.
  const path = join(WORKTREE_ROOT, name);
  git(origin, "worktree", "add", "-q", "-b", `session_${name}`, path, "main");

  // The ownership marker is what makes a directory sweepable at all.
  mkdirSync(join(WORKTREE_ROOT, ".lfg-owned"), { recursive: true });
  writeFileSync(join(WORKTREE_ROOT, ".lfg-owned", name), `${Date.now()}\n`);
  return path;
}

function cleanupWorktree(name: string): void {
  rmSync(join(WORKTREE_ROOT, name), { recursive: true, force: true });
  rmSync(join(WORKTREE_ROOT, ".lfg-owned", name), { force: true });
}

describe("worktree sweeper", () => {
  const originalData = PATHS.data;
  const names: string[] = [];
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), "lfg-sweep-"));
    PATHS.data = join(dataRoot, "data");
    mkdirSync(PATHS.data, { recursive: true });
    resetManagedRegistryForTests();
    resetResumeCacheConnectionForTests();
  });

  afterEach(() => {
    for (const name of names.splice(0)) cleanupWorktree(name);
    resetManagedRegistryForTests();
    resetResumeCacheConnectionForTests();
    PATHS.data = originalData;
    rmSync(dataRoot, { recursive: true, force: true });
  });

  function register(name: string): string {
    names.push(name);
    return makeOwnedWorktree(name, dataRoot);
  }

  test("keeps the worktree of a session that was active recently", async () => {
    const name = `lfg-sweep-recent-${process.pid}`;
    register(name);
    const now = Date.now();
    upsertResumableRows([{
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      cwd: join(WORKTREE_ROOT, name),
      project: "test",
      title: "mid-task when the box rebooted",
      lastActivityAt: now - 60_000,
      lastUserText: "keep going",
      agent: "claude",
      path: null,
      mtimeMs: now,
    }]);

    const r = await sweepStaleWorktrees({ minAgeMs: 0, now, recentActivityMs: 24 * 60 * 60_000 });

    expect(r.removed).not.toContain(name);
    expect(r.recentlyActive).toContain(name);
  });

  test("still reclaims a worktree once its session has gone quiet", async () => {
    const name = `lfg-sweep-stale-${process.pid}`;
    register(name);
    const now = Date.now();
    upsertResumableRows([{
      sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      cwd: join(WORKTREE_ROOT, name),
      project: "test",
      title: "finished days ago",
      lastActivityAt: now - 5 * 24 * 60 * 60_000,
      lastUserText: "thanks",
      agent: "claude",
      path: null,
      mtimeMs: now,
    }]);

    const r = await sweepStaleWorktrees({ minAgeMs: 0, now, recentActivityMs: 24 * 60 * 60_000 });

    expect(r.recentlyActive).not.toContain(name);
    expect(r.removed).toContain(name);
    expect(
      Bun.spawnSync(["git", "-C", join(dataRoot, "repo"), "show-ref", "--verify", `refs/heads/session_${name}`]).exitCode,
    ).not.toBe(0);
  });
});
