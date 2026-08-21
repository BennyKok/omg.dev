import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteMergedSessionBranch,
  maintainOwnershipMarkers,
  maintainProject,
} from "./project-maintenance.ts";

const roots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return result.stdout.toString().trim();
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "omg-project-maintenance-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "file.txt"), "base\n");
  git(root, "add", "file.txt");
  git(root, "commit", "-qm", "base");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("project maintenance", () => {
  test("removes only merged session branches and stale worktree metadata", async () => {
    const root = repo();
    git(root, "branch", "session_lfg-merged");
    git(root, "switch", "-qc", "session_lfg-unmerged");
    writeFileSync(join(root, "unmerged.txt"), "keep\n");
    git(root, "add", "unmerged.txt");
    git(root, "commit", "-qm", "unmerged");
    git(root, "switch", "-q", "main");

    const missing = join(root, "missing-worktree");
    git(root, "worktree", "add", "-q", "-b", "session_lfg-missing", missing, "main");
    rmSync(missing, { recursive: true, force: true });

    const status = await maintainProject({ name: "test", cwd: root });
    expect(status.sessionBranches).toBe(3);
    expect(status.mergedSessionBranches).toEqual(["session_lfg-merged"]);
    expect(status.checkedOutMergedBranches).toEqual(["session_lfg-missing"]);
    expect(status.prunableWorktrees).toEqual([missing]);
    expect(git(root, "show-ref", "--verify", "refs/heads/session_lfg-merged")).toBeTruthy();

    const cleaned = await maintainProject({ name: "test", cwd: root }, true);
    expect(cleaned.removedSessionBranches.sort()).toEqual([
      "session_lfg-merged",
      "session_lfg-missing",
    ]);
    expect(cleaned.prunedWorktrees).toBe(1);
    expect(git(root, "show-ref", "--verify", "refs/heads/session_lfg-unmerged")).toBeTruthy();
    expect(Bun.spawnSync(["git", "-C", root, "show-ref", "--verify", "refs/heads/session_lfg-merged"]).exitCode).not.toBe(0);
  });

  test("keeps a merged branch while another worktree has it checked out", async () => {
    const root = repo();
    const active = join(root, "active-worktree");
    git(root, "worktree", "add", "-q", "-b", "session_lfg-active", active, "main");

    const cleaned = await maintainProject({ name: "test", cwd: root }, true);

    expect(cleaned.checkedOutMergedBranches).toEqual(["session_lfg-active"]);
    expect(cleaned.removedSessionBranches).toEqual([]);
    expect(existsSync(active)).toBe(true);
  });

  test("removes only ownership markers whose worktree is gone", async () => {
    const root = mkdtempSync(join(tmpdir(), "omg-marker-maintenance-"));
    roots.push(root);
    mkdirSync(join(root, ".lfg-owned"), { recursive: true });
    mkdirSync(join(root, "active"));
    writeFileSync(join(root, ".lfg-owned", "active"), "1\n");
    writeFileSync(join(root, ".lfg-owned", "gone"), "1\n");

    const status = await maintainOwnershipMarkers(root);
    expect(status).toMatchObject({ total: 2, orphaned: ["gone"], removed: [] });

    const cleaned = await maintainOwnershipMarkers(root, true);
    expect(cleaned.removed).toEqual(["gone"]);
    expect(existsSync(join(root, ".lfg-owned", "active"))).toBe(true);
    expect(existsSync(join(root, ".lfg-owned", "gone"))).toBe(false);
  });

  test("deletes one managed branch only when main already contains it", async () => {
    const root = repo();
    git(root, "branch", "session_lfg-merged");
    git(root, "switch", "-qc", "session_lfg-unmerged");
    writeFileSync(join(root, "unmerged.txt"), "keep\n");
    git(root, "add", "unmerged.txt");
    git(root, "commit", "-qm", "unmerged");
    git(root, "switch", "-q", "main");

    expect(await deleteMergedSessionBranch(root, "session_lfg-merged")).toBe(true);
    expect(await deleteMergedSessionBranch(root, "session_lfg-unmerged")).toBe(false);
    expect(await deleteMergedSessionBranch(root, "human-branch")).toBe(false);
    expect(Bun.spawnSync(["git", "-C", root, "show-ref", "--verify", "refs/heads/session_lfg-merged"]).exitCode).not.toBe(0);
    expect(git(root, "show-ref", "--verify", "refs/heads/session_lfg-unmerged")).toBeTruthy();
  });
});
