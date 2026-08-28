// Deleting a project folder from disk.
//
// `DELETE /api/repos` only unpins a custom path — the directory stays. This
// module is the other half: actually removing the folder, which is the only way
// to clear out the abandoned "New Project" shells that accumulate in the repos
// root. Because the operation is an unrecoverable `rm -rf` reachable over HTTP,
// everything here is built around two ideas:
//
//   1. Some paths are never deletable, no matter what the caller confirms.
//   2. The caller must be told what is inside BEFORE it can confirm.
//
// So the flow is always plan-then-delete: `planFolderDelete` reports contents
// and warnings, `deleteFolder` re-derives the same guards and only then unlinks.
// Guards are re-checked on the delete call rather than trusted from the plan,
// so a stale or forged plan cannot widen what a confirm is allowed to remove.

import { opendir, readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { PATHS } from "./config.ts";

export type FolderDeletePlan = {
  path: string;
  name: string;
  /** No directory entries at all, including dotfiles. */
  empty: boolean;
  /**
   * How many things the user would recognise as content.
   *
   * Excludes `.git`, whose loss is described by the git-specific warnings
   * instead — counting it would make "Contains 4 items" disagree with the
   * three names listed beside it.
   */
  entryCount: number;
  /** First few entry names, for showing the user what they are about to lose. */
  entries: string[];
  isGitRepo: boolean;
  /** Tracked-file changes that exist only in this working tree. */
  gitDirty: boolean;
  /**
   * Nothing here but scaffolding: safe to offer a light confirmation.
   *
   * The folders this feature exists to clean up are almost never *literally*
   * empty — "New Project" leaves a README, a .git, and one commit behind — so
   * treating only zero-entry folders as harmless would still put a scary
   * warning in front of every folder the user actually wants gone.
   */
  looksUnused: boolean;
  /** Human-readable reasons to hesitate, most important first. */
  warnings: string[];
};

export type FolderDeleteGuards = {
  home: string;
  reposRoot: string;
  worktreeRoot: string;
  selfRepo: string;
  dataDir: string;
};

export class FolderDeleteError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "FolderDeleteError";
    this.status = status;
  }
}

// Scaffolding a fresh project leaves these behind. Their presence says nothing
// about whether the folder was ever used.
const SCAFFOLD_ENTRIES = new Set([".git", ".gitignore", ".DS_Store", "README.md"]);

const MAX_LISTED_ENTRIES = 8;

/** Is `child` strictly inside `parent`? Equal paths are not "inside". */
function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const proc = Bun.spawn({
      cmd: ["git", "-C", cwd, ...args],
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return { ok: code === 0, out };
  } catch {
    return { ok: false, out: "" };
  }
}

export function defaultGuards(overrides: Partial<FolderDeleteGuards> = {}): FolderDeleteGuards {
  const home = homedir();
  return {
    home,
    reposRoot: `${home}/repos`,
    worktreeRoot: `${home}/lfg-worktrees`,
    selfRepo: process.cwd(),
    dataDir: PATHS.data,
    ...overrides,
  };
}

/**
 * Why this path may never be deleted, or null if it may.
 *
 * Refuses the guarded roots themselves AND any ancestor of them: deleting `~`
 * or a folder that happens to contain the LFG install would take the guarded
 * path with it, so "is it one of them" is not a sufficient test.
 */
async function protectedReason(
  target: string,
  guards: FolderDeleteGuards,
): Promise<string | null> {
  const labelled: [string, string][] = [
    [guards.home, "your home folder"],
    [guards.reposRoot, "your projects folder"],
    [guards.worktreeRoot, "the worktree folder LFG manages"],
    [guards.selfRepo, "LFG's own installation"],
    [guards.dataDir, "LFG's data folder"],
  ];
  for (const [rawPath, label] of labelled) {
    // Resolve each guard the same way the target was resolved, so a symlinked
    // home or repos root cannot be deleted by asking for it under its other
    // name. A guard that does not exist yet simply cannot be hit.
    const guard = await realpathOrNull(rawPath);
    if (!guard) continue;
    if (guard === target) return `${label} can't be deleted`;
    if (isInside(target, guard)) return `that folder contains ${label}`;
  }
  return null;
}

/**
 * Resolve a caller-supplied path to a canonical, deletable directory.
 *
 * Throws FolderDeleteError with the status the route should return.
 */
export async function resolveDeletableFolder(
  rawPath: string,
  guards: FolderDeleteGuards,
): Promise<string> {
  const trimmed = rawPath.trim();
  if (!trimmed) throw new FolderDeleteError(400, "path is required");
  const expanded = trimmed === "~" ? guards.home : trimmed.replace(/^~(?=\/)/, guards.home);

  const target = await realpathOrNull(resolve(expanded));
  if (!target) throw new FolderDeleteError(400, "folder does not exist");

  const info = await stat(target).catch(() => null);
  if (!info?.isDirectory()) throw new FolderDeleteError(400, "not a folder");

  // Same containment rule the folder browser enforces: you can only act on
  // what you can see.
  const home = (await realpathOrNull(guards.home)) ?? guards.home;
  if (target !== home && !isInside(home, target)) {
    throw new FolderDeleteError(403, "folder deletion is limited to your home directory");
  }

  const blocked = await protectedReason(target, guards);
  if (blocked) throw new FolderDeleteError(400, blocked);

  return target;
}

/** Cheap emptiness test: reads one entry instead of the whole directory. */
export async function isDirEmpty(path: string): Promise<boolean> {
  let dir;
  try {
    dir = await opendir(path);
  } catch {
    // Unreadable — report "not empty" so we never advertise a folder as
    // harmless when we could not actually look inside it.
    return false;
  }
  try {
    return (await dir.read()) === null;
  } catch {
    return false;
  } finally {
    // Reading past the last entry auto-closes the handle, so this close is
    // usually a double close (ERR_DIR_CLOSED). Bun also returns undefined here
    // rather than a promise, so this cannot be a `.catch()` — swallowing it in
    // the finally is what keeps a listing of N folders from throwing N times.
    try {
      await dir.close();
    } catch {}
  }
}

/**
 * Describe what deleting `rawPath` would destroy. Never mutates anything.
 */
export async function planFolderDelete(
  rawPath: string,
  guards: FolderDeleteGuards,
): Promise<FolderDeletePlan> {
  const target = await resolveDeletableFolder(rawPath, guards);

  const allEntries = (await readdir(target).catch(() => [] as string[])).sort((a, b) =>
    a.localeCompare(b),
  );
  const entryCount = allEntries.length;
  const isGitRepo = await stat(join(target, ".git"))
    .then(() => true)
    .catch(() => false);

  let gitDirty = false;
  let commitCount = 0;
  let hasRemote = false;
  let unpushed = 0;
  if (isGitRepo) {
    const status = await git(target, ["status", "--porcelain"]);
    // Fail closed: an unreadable repo counts as dirty rather than disposable.
    gitDirty = !status.ok || status.out.trim().length > 0;
    const count = await git(target, ["rev-list", "--count", "HEAD"]);
    commitCount = count.ok ? Number.parseInt(count.out.trim(), 10) || 0 : 0;
    hasRemote = (await git(target, ["remote"])).out.trim().length > 0;
    if (hasRemote) {
      const ahead = await git(target, ["log", "--branches", "--not", "--remotes", "--oneline"]);
      unpushed = ahead.ok ? ahead.out.trim().split("\n").filter(Boolean).length : 0;
    }
  }

  // Two different questions, deliberately not the same filter:
  //   visible    — what the user would call the folder's contents (for display)
  //   meaningful — anything that isn't fresh-project scaffolding (for the
  //                "is this junk?" judgement, which is allowed to be lenient)
  const visible = allEntries.filter((entry) => entry !== ".git");
  const meaningful = allEntries.filter((entry) => !SCAFFOLD_ENTRIES.has(entry));
  const looksUnused = meaningful.length === 0 && !gitDirty && commitCount <= 1;

  const warnings: string[] = [];
  if (gitDirty) warnings.push("Has uncommitted changes that exist nowhere else");
  if (visible.length > 0) {
    warnings.push(
      `Contains ${visible.length} item${visible.length === 1 ? "" : "s"} that will be permanently deleted`,
    );
  }
  if (isGitRepo && !hasRemote && commitCount > 1) {
    warnings.push(`${commitCount} commits with no git remote — this history is not backed up`);
  }
  if (unpushed > 0) {
    warnings.push(`${unpushed} commit${unpushed === 1 ? "" : "s"} not pushed to any remote`);
  }

  return {
    path: target,
    name: basename(target),
    // looksUnused already means "no dirty state, no history, nothing but
    // scaffolding" — there is nothing left to warn about, and a folder shown
    // on the light path must never also carry a "Contains 1 item" warning.
    warnings: looksUnused ? [] : warnings,
    empty: entryCount === 0,
    entryCount: visible.length,
    entries: visible.slice(0, MAX_LISTED_ENTRIES),
    isGitRepo,
    gitDirty,
    looksUnused,
  };
}

/**
 * Delete the folder. Re-runs every guard from scratch — the plan is advisory,
 * not an authorization token.
 */
export async function deleteFolder(
  rawPath: string,
  guards: FolderDeleteGuards,
): Promise<string> {
  const target = await resolveDeletableFolder(rawPath, guards);
  // A linked worktree leaves a registration behind in its owning checkout, so
  // hand the removal to git when we can and prune the stale entry when we
  // cannot. Plain `rm -rf` on a worktree is what makes `git worktree list`
  // start reporting directories that no longer exist.
  const owner = await worktreeOwner(target);
  if (owner) {
    const removed = await git(owner, ["worktree", "remove", "--force", target]);
    if (removed.ok) return target;
  }
  await rm(target, { recursive: true, force: true });
  if (owner) await git(owner, ["worktree", "prune"]);
  return target;
}

/** The checkout that owns `target`, when target is a linked git worktree. */
async function worktreeOwner(target: string): Promise<string | null> {
  const info = await stat(join(target, ".git")).catch(() => null);
  // A real .git directory means a standalone repo; only a .git *file* points
  // at an owning checkout.
  if (!info || info.isDirectory()) return null;
  const common = await git(target, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok) return null;
  const dir = common.out.trim();
  if (!dir.endsWith("/.git")) return null;
  const owner = dir.slice(0, -"/.git".length);
  return (await realpathOrNull(owner)) ?? null;
}
