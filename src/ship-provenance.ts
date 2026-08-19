// A Shipped post claims a verified result. For LFG's own repo,
// `verifySelfRepoLanding` can prove the whole delivery chain and refuses the
// ship otherwise — but that gate only fires when the session's repoRoot IS
// this repo. Sessions in every other project (vibes, whatsapp-bot, ...) shipped
// with no source-control check at all, so "shipped" and "landed on main" drifted
// apart silently and a reader had no way to tell which posts carried code.
//
// This records what Git actually says about the session worktree at ship time
// and stores it on the post. It does not block: plenty of real ships are ops,
// research, or deploy work with no commit to show. The point is that the feed
// stops implying a commit that isn't there.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ManagedSession } from "./managed.ts";

const MAIN_REF = "origin/main";

export type ShipProvenanceState =
  // Worktree had uncommitted edits when the post went up.
  | "uncommitted"
  // Committed, but those commits have not reached origin/main.
  | "unlanded"
  // Committed and reached origin/main.
  | "landed"
  // A clean worktree sitting exactly on main: this session wrote no code.
  | "clean"
  // Not a readable Git checkout, or the worktree is gone.
  | "unknown";

export type ShipProvenance = {
  state: ShipProvenanceState;
  branch?: string;
  /** Short HEAD sha, for tracing a post back to a commit. */
  head?: string;
  /** Paths with uncommitted changes. */
  dirty: number;
  /** Commits on HEAD that origin/main lacks entirely — the unlanded ones. */
  ahead: number;
  /** Commits on HEAD not in origin/main by sha, squash-merged ones included. */
  commits: number;
};

type GitResult = { ok: boolean; out: string; err: string };

function git(cwd: string, args: string[]): GitResult {
  const proc = Bun.spawnSync({
    cmd: ["git", "-C", cwd, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: proc.exitCode === 0,
    out: proc.stdout.toString().trim(),
    err: proc.stderr.toString().trim(),
  };
}

/**
 * Turn raw Git facts into the label the feed shows.
 *
 * Order matters: uncommitted work outranks an unlanded commit, because a post
 * whose worktree is dirty is the least traceable of all — there is no sha a
 * reader can check out. `clean` is deliberately distinct from `landed`: a
 * session that never touched code is an honest ship, but it should not wear
 * the same badge as one that actually landed a commit.
 */
export function classifyShipProvenance(facts: {
  /** `git status` was readable. */
  readable: boolean;
  /** origin/main resolved, so "did this land" is answerable. */
  reachable: boolean;
  dirty: number;
  /** Genuinely unlanded commits (patch equivalents already excluded). */
  ahead: number;
  /** Commits ahead of origin/main by sha, squash-merged ones included. */
  commits: number;
}): ShipProvenanceState {
  if (!facts.readable) return "unknown";
  // Checked before reachability on purpose: a dirty worktree is the least
  // traceable state there is, and it stays a fact whether or not the remote
  // answered. Demoting it to "unknown" because a fetch failed would hide the
  // exact case this record exists to surface.
  if (facts.dirty > 0) return "uncommitted";
  if (!facts.reachable) return "unknown";
  if (facts.ahead > 0) return "unlanded";
  // Commits that exist but are all accounted for upstream. A squash-merged
  // branch lands without any of its shas appearing in main, so `commits` is
  // what separates real landed work from a session that wrote nothing.
  return facts.commits > 0 ? "landed" : "clean";
}

/**
 * Commits on HEAD that origin/main lacks.
 *
 * `git cherry` marks patch-equivalent commits with "-", so a squash-merged
 * branch reads as zero ahead rather than as unlanded work — the same rule
 * `verifySelfRepoLanding` uses, for the same reason.
 */
/**
 * Where this session's branch started.
 *
 * Counting the session's commits as `origin/main..HEAD` is wrong the moment
 * main moves on: once the work lands, HEAD becomes an ancestor of main, the
 * range goes empty, and a session that shipped five real commits reads as
 * having written no code. LFG creates each session worktree with a fresh
 * branch, so the oldest reflog entry for that branch ("branch: Created from
 * origin/main") is the honest base and survives main advancing.
 */
function sessionBase(cwd: string, branch: string | undefined): string | null {
  if (!branch) return null;
  const reflog = git(cwd, ["reflog", "show", "--no-abbrev", branch]);
  if (!reflog.ok) return null;
  const lines = reflog.out.split("\n").filter(Boolean);
  const created = lines[lines.length - 1];
  const sha = created?.split(/\s/)[0];
  if (!sha) return null;
  // A reflog entry records the ref's value AFTER the action, so for the
  // creation entry that value is the commit the branch was cut from.
  const verified = git(cwd, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]);
  return verified.ok && verified.out ? verified.out : null;
}

function commitCounts(
  cwd: string,
  branch: string | undefined,
): { ahead: number; commits: number } | null {
  // Unlanded work is always measured against main, patch-equivalence aware so
  // a squash-merged branch does not read as outstanding.
  const cherry = git(cwd, ["cherry", MAIN_REF, "HEAD"]);
  if (!cherry.ok) return null;
  const ancestor = git(cwd, ["merge-base", "--is-ancestor", "HEAD", MAIN_REF]);
  const ahead = ancestor.ok
    ? 0
    : cherry.out
        .split("\n")
        .filter(Boolean)
        .filter((line) => line.startsWith("+")).length;

  const base = sessionBase(cwd, branch);
  const range = git(cwd, ["rev-list", "--count", `${base ?? MAIN_REF}..HEAD`]);
  const commits = range.ok ? Number(range.out) || 0 : 0;
  // Never claim fewer commits than there is outstanding work for.
  return { ahead, commits: Math.max(commits, ahead) };
}

/**
 * Read the session worktree's Git state at ship time.
 *
 * Best-effort by design — a session with no worktree (attached, historical, or
 * a plain chat) gets no provenance rather than a misleading "unknown" badge.
 * Never throws: a broken checkout must not cost an agent its ship post.
 */
export function collectShipProvenance(
  managed: Pick<ManagedSession, "cwd" | "worktreeBranch"> | undefined,
): ShipProvenance | undefined {
  const cwd = managed?.cwd ? resolve(managed.cwd) : "";
  if (!cwd || !existsSync(cwd)) return undefined;

  try {
    const inRepo = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    if (!inRepo.ok || inRepo.out !== "true") return undefined;

    const status = git(cwd, ["status", "--porcelain"]);
    const head = git(cwd, ["rev-parse", "--short", "HEAD"]);
    const branchRes = git(cwd, ["branch", "--show-current"]);
    const branch = branchRes.ok && branchRes.out ? branchRes.out : undefined;
    // Without a refresh, a worktree that has been idle for days measures
    // itself against a stale origin/main and reports landed work as unlanded.
    git(cwd, ["fetch", "--quiet", "origin", "main"]);
    const reach = commitCounts(cwd, branch ?? managed?.worktreeBranch);

    const dirty = status.ok ? status.out.split("\n").filter(Boolean).length : 0;
    const state = classifyShipProvenance({
      readable: status.ok,
      reachable: !!reach,
      dirty,
      ahead: reach?.ahead ?? 0,
      commits: reach?.commits ?? 0,
    });

    return {
      state,
      branch: branch ?? managed?.worktreeBranch,
      head: head.ok && head.out ? head.out : undefined,
      dirty,
      ahead: reach?.ahead ?? 0,
      commits: reach?.commits ?? 0,
    };
  } catch {
    return undefined;
  }
}
