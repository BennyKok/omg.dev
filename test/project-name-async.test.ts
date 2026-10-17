import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectName, projectNameAsync } from "../src/projects.ts";

// The repo list moved to projectNameAsync so a slow disk after a wake cannot
// stop every LFG request. Failure this must catch: a project shown under a
// different name than before (a worktree no longer collapsing onto its repo).
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("matches projectName for a repo, a linked worktree, and a folder without git", async () => {
  const root = mkdtempSync(join(tmpdir(), "project-name-async-"));
  dirs.push(root);
  const repo = join(root, "app");
  mkdirSync(join(repo, ".git", "worktrees", "feature"), { recursive: true });
  const worktree = join(root, "app-feature");
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "feature")}\n`);
  const plain = join(root, "notes");
  mkdirSync(plain, { recursive: true });

  for (const cwd of [repo, worktree, plain]) {
    expect(await projectNameAsync(cwd)).toBe(projectName(cwd));
  }
  expect(await projectNameAsync(worktree)).toBe(await projectNameAsync(repo));
});
