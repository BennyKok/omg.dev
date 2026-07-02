// Merge-guard: before the session-brain archives/closes a session, make sure
// the work living on its per-session worktree branch (`session_<name>`, created
// off origin/main in worktree.ts) is not silently discarded. Worktree cleanup
// removes only the checkout directory, never the branch — so unmerged commits
// become orphaned and effectively lost the moment the session is closed.
//
// This module inspects the branch state and lets the brain re-engage the live
// agent to decide whether the work needs merging, rather than deciding merges
// itself. It never merges or pushes on its own (auto-pushing to a shared main
// from many concurrent sessions is unsafe) — it only gates the close and asks
// the agent to resolve.

import { basename, dirname, resolve } from "node:path";
import { WORKTREE_ROOT } from "../worktree.ts";
import type { Session } from "../sessions.ts";
import { MAIN_REF } from "../agents/collectors/git-fresh.ts";

export type BranchState = {
  wtPath: string;
  repoRoot: string;
  branch: string;
  aheadCommits: number; // commits on the branch not yet in origin/main
  dirtyFiles: number; // uncommitted (staged + unstaged + untracked) changes
  fetchOk: boolean;
};

function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
  const proc = Bun.spawnSync({
    cmd: ["git", "-C", cwd, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: proc.exitCode === 0,
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
  };
}

// Only sessions whose cwd is an lfg-managed worktree carry a session branch we
// are responsible for. Anything else (self-repo, worktree disabled, ad-hoc
// cwd) returns null and is never gated.
function worktreeCwd(session: Session): string | null {
  if (!session.cwd) return null;
  const abs = resolve(session.cwd);
  if (abs !== resolve(WORKTREE_ROOT) && !abs.startsWith(resolve(WORKTREE_ROOT) + "/")) {
    return null;
  }
  return abs;
}

function repoRootFromWorktree(wtPath: string): string | null {
  const r = git(wtPath, ["rev-parse", "--git-common-dir"]);
  if (!r.ok) return null;
  return dirname(resolve(wtPath, r.out.trim()));
}

// Inspect the session's worktree branch. Returns null when the session has no
// managed worktree (nothing to guard) or the checkout is unreadable.
export function inspectSessionBranch(session: Session): BranchState | null {
  const wtPath = worktreeCwd(session);
  if (!wtPath) return null;

  const head = git(wtPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!head.ok) return null;
  const branch = head.out.trim() || `session_${basename(wtPath)}`;

  const repoRoot = repoRootFromWorktree(wtPath) ?? wtPath;

  // Refresh origin/main so "unmerged" is measured against what's actually on
  // the remote right now, not a stale tracking ref.
  const fetch = git(wtPath, ["fetch", "--quiet", "origin", "main"]);

  const ahead = git(wtPath, ["rev-list", "--count", `${MAIN_REF}..HEAD`]);
  const aheadCommits = ahead.ok ? Number(ahead.out.trim()) || 0 : 0;

  const status = git(wtPath, ["status", "--porcelain"]);
  const dirtyFiles = status.ok
    ? status.out.split("\n").filter((l) => l.trim()).length
    : 0;

  return {
    wtPath,
    repoRoot,
    branch,
    aheadCommits,
    dirtyFiles,
    fetchOk: fetch.ok,
  };
}

export function hasUnmergedWork(state: BranchState | null): boolean {
  if (!state) return false;
  return state.aheadCommits > 0 || state.dirtyFiles > 0;
}

// The agent can short-circuit the guard by explicitly declaring the branch
// disposable in its recent output, so the brain doesn't keep nagging about a
// dead-end experiment. Kept deliberately conservative.
const DISCARD_RE =
  /\b(discard(?:able)?|throw[- ]?away|disposable|abandon(?:ed)?|dead[- ]?end|do not merge|don'?t merge|no merge needed|nothing to merge|scrap(?:ped)?|safe to (?:delete|drop|discard))\b/i;

export function agentSignaledDisposable(recentText: string | null | undefined): boolean {
  return !!recentText && DISCARD_RE.test(recentText);
}

export function describeBranchState(state: BranchState): string {
  const parts: string[] = [];
  if (state.aheadCommits > 0) {
    parts.push(`${state.aheadCommits} commit${state.aheadCommits === 1 ? "" : "s"} not merged into ${MAIN_REF}`);
  }
  if (state.dirtyFiles > 0) {
    parts.push(`${state.dirtyFiles} uncommitted change${state.dirtyFiles === 1 ? "" : "s"}`);
  }
  return parts.join(" and ") || "no outstanding changes";
}

// The follow-up we inject into the live session so its own agent decides the
// fate of the branch. We ask, we never merge.
export function mergeFollowUpPrompt(state: BranchState): string {
  return [
    `[session-brain] Before this session is archived, I noticed your worktree branch \`${state.branch}\` has ${describeBranchState(state)}.`,
    "",
    "Please decide what should happen to this work and act on it now:",
    "- If it should be kept: commit anything outstanding, then merge it to main or open a PR (e.g. `gh pr create` / `gh pr merge --squash --delete-branch`), and confirm when done.",
    "- If it's a dead end / disposable: reply saying so explicitly (e.g. \"discard — <reason>\") and I'll archive without merging.",
    "- If you're still mid-task: just keep going; I'll re-check before archiving again.",
  ].join("\n");
}

// ---- prompt sender registration ------------------------------------------
// serve.ts owns the live-session transport (aisdk command queue / tmux). It
// registers a sender at startup so this module can nudge a session without
// importing the server (which would be a cycle).

export type BrainPromptSender = (
  session: Session,
  text: string,
  opts?: { mode?: "steer" | "queue" },
) => { ok: boolean; error?: string };

let promptSender: BrainPromptSender | null = null;

export function setBrainPromptSender(fn: BrainPromptSender): void {
  promptSender = fn;
}

export function sendBrainPrompt(
  session: Session,
  text: string,
  opts?: { mode?: "steer" | "queue" },
): { ok: boolean; error?: string } {
  if (!promptSender) return { ok: false, error: "no prompt sender registered" };
  try {
    return promptSender(session, text, opts);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
