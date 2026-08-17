import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { WORKTREE_ROOT } from "./config.ts";

export type ProjectMaintenanceReport = {
  name: string;
  cwd: string;
  sourceBranch: string | null;
  dirty: boolean;
  worktrees: number;
  prunableWorktrees: string[];
  sessionBranches: number;
  mergedSessionBranches: string[];
  checkedOutMergedBranches: string[];
  removedSessionBranches: string[];
  prunedWorktrees: number;
  error?: string;
};

type GitResult = { ok: boolean; out: string; err: string };

async function git(cwd: string, args: string[], stdin?: string): Promise<GitResult> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", cwd, ...args],
    stdin: stdin === undefined ? undefined : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (stdin !== undefined) {
    proc.stdin.write(stdin);
    proc.stdin.end();
  }
  const [out, err, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: exitCode === 0, out, err };
}

function lines(text: string): string[] {
  return text.split("\n").map(line => line.trim()).filter(Boolean);
}

function parseWorktrees(text: string): {
  count: number;
  prunable: string[];
  checkedOutBranches: Set<string>;
} {
  let count = 0;
  let currentPath = "";
  const prunable: string[] = [];
  const checkedOutBranches = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) {
      count++;
      currentPath = line.slice("worktree ".length);
    } else if (line.startsWith("branch refs/heads/")) {
      checkedOutBranches.add(line.slice("branch refs/heads/".length));
    } else if (line.startsWith("prunable ") && currentPath) {
      prunable.push(currentPath);
    }
  }
  return { count, prunable, checkedOutBranches };
}

async function sourceBranch(cwd: string): Promise<string | null> {
  const main = await git(cwd, ["show-ref", "--verify", "--quiet", "refs/heads/main"]);
  if (main.ok) return "main";

  const remoteHead = await git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remoteHead.ok) {
    const name = remoteHead.out.trim().replace(/^origin\//, "");
    if (name) {
      const local = await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
      if (local.ok) return name;
    }
  }
  return null;
}

async function sessionRefs(
  cwd: string,
  mergedInto?: string,
): Promise<Array<{ branch: string; oid: string }>> {
  const args = ["for-each-ref", "--format=%(refname:short)%09%(objectname)"];
  if (mergedInto) args.push(`--merged=${mergedInto}`);
  args.push("refs/heads/session_lfg-*");
  const result = await git(cwd, args);
  if (!result.ok) throw new Error(result.err.trim() || "git for-each-ref failed");
  return lines(result.out).flatMap(line => {
    const [branch, oid] = line.split("\t");
    return branch && oid ? [{ branch, oid }] : [];
  });
}

async function deleteRefs(
  cwd: string,
  refs: Array<{ branch: string; oid: string }>,
): Promise<void> {
  if (!refs.length) return;
  const transaction = [
    "start",
    ...refs.map(ref => `delete refs/heads/${ref.branch} ${ref.oid}`),
    "prepare",
    "commit",
    "",
  ].join("\n");
  const result = await git(cwd, ["update-ref", "--stdin"], transaction);
  if (!result.ok) throw new Error(result.err.trim() || "git update-ref failed");
}

/**
 * Delete one managed session branch only after its commit is in local main and
 * no worktree has the branch checked out. A changed ref makes the atomic delete
 * fail instead of deleting the new commit.
 */
export async function deleteMergedSessionBranch(
  cwd: string,
  branch: string,
): Promise<boolean> {
  if (!branch.startsWith("session_lfg-")) return false;
  const target = await sourceBranch(cwd);
  if (!target) return false;
  const refs = await git(cwd, [
    "for-each-ref",
    "--format=%(refname:short)%09%(objectname)",
    `refs/heads/${branch}`,
  ]);
  if (!refs.ok) return false;
  const [ref] = lines(refs.out).flatMap(line => {
    const [name, oid] = line.split("\t");
    return name && oid ? [{ branch: name, oid }] : [];
  });
  if (!ref || ref.branch !== branch) return false;

  const merged = await git(cwd, ["merge-base", "--is-ancestor", ref.oid, target]);
  if (!merged.ok) return false;
  const worktrees = await git(cwd, ["worktree", "list", "--porcelain"]);
  if (!worktrees.ok || parseWorktrees(worktrees.out).checkedOutBranches.has(branch)) return false;
  await deleteRefs(cwd, [ref]);
  return true;
}

/**
 * Inspect or clean one project without touching working files.
 *
 * Cleanup is conservative. It prunes only worktree metadata whose directory is
 * already gone. It deletes only omg.dev session refs already contained in the
 * project's local main branch. Git's expected-object transaction makes the
 * deletion fail closed if any ref changes during the scan.
 */
export async function maintainProject(
  project: { name: string; cwd: string },
  apply = false,
): Promise<ProjectMaintenanceReport> {
  const report: ProjectMaintenanceReport = {
    ...project,
    sourceBranch: null,
    dirty: false,
    worktrees: 0,
    prunableWorktrees: [],
    sessionBranches: 0,
    mergedSessionBranches: [],
    checkedOutMergedBranches: [],
    removedSessionBranches: [],
    prunedWorktrees: 0,
  };
  try {
    const before = await git(project.cwd, ["worktree", "list", "--porcelain"]);
    if (!before.ok) throw new Error(before.err.trim() || "git worktree list failed");
    const beforeWorktrees = parseWorktrees(before.out);
    report.worktrees = beforeWorktrees.count;
    report.prunableWorktrees = beforeWorktrees.prunable;

    if (apply && beforeWorktrees.prunable.length) {
      const pruned = await git(project.cwd, ["worktree", "prune", "--expire", "now"]);
      if (!pruned.ok) throw new Error(pruned.err.trim() || "git worktree prune failed");
      report.prunedWorktrees = beforeWorktrees.prunable.length;
    }

    let current = beforeWorktrees;
    if (apply) {
      const refreshed = await git(project.cwd, ["worktree", "list", "--porcelain"]);
      if (!refreshed.ok) {
        throw new Error(refreshed.err.trim() || "git worktree list failed after prune");
      }
      current = parseWorktrees(refreshed.out);
    }
    const branch = await sourceBranch(project.cwd);
    report.sourceBranch = branch;
    const all = await sessionRefs(project.cwd);
    report.sessionBranches = all.length;
    if (branch) {
      const merged = await sessionRefs(project.cwd, branch);
      const removable = merged.filter(ref => !current.checkedOutBranches.has(ref.branch));
      report.mergedSessionBranches = removable.map(ref => ref.branch);
      report.checkedOutMergedBranches = merged
        .filter(ref => current.checkedOutBranches.has(ref.branch))
        .map(ref => ref.branch);
      if (apply) {
        await deleteRefs(project.cwd, removable);
        report.removedSessionBranches = removable.map(ref => ref.branch);
      }
    }

    const status = await git(project.cwd, ["status", "--porcelain"]);
    if (!status.ok) throw new Error(status.err.trim() || "git status failed");
    report.dirty = status.out.trim().length > 0;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }
  return report;
}

export type OwnershipMarkerReport = {
  total: number;
  orphaned: string[];
  removed: string[];
};

/** Remove sidecar markers only when their worktree directory no longer exists. */
export async function maintainOwnershipMarkers(
  worktreeRoot = WORKTREE_ROOT,
  apply = false,
): Promise<OwnershipMarkerReport> {
  const markerRoot = join(worktreeRoot, ".lfg-owned");
  const report: OwnershipMarkerReport = { total: 0, orphaned: [], removed: [] };
  let names: string[];
  try {
    names = await readdir(markerRoot);
  } catch {
    return report;
  }
  for (const name of names) {
    const marker = join(markerRoot, name);
    let markerIsFile = false;
    try {
      markerIsFile = (await stat(marker)).isFile();
    } catch {}
    if (!markerIsFile) continue;
    report.total++;
    if (existsSync(join(worktreeRoot, name))) continue;
    report.orphaned.push(name);
    if (apply) {
      await rm(marker, { force: true });
      report.removed.push(name);
    }
  }
  return report;
}
