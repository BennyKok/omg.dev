// Auto-provision an isolated git worktree per lfg-managed session so agents
// never collide on a shared checkout (see docs/repo-hygiene.md). Voice-only
// orchestrator sessions are the lone automatic exception.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { WORKTREE_ROOT } from "./config.ts";
import { MAIN_REF } from "./agents/collectors/git-fresh.ts";
import { listManaged } from "./managed.ts";
import { deleteMergedSessionBranch } from "./project-maintenance.ts";
import { lastActivityAtForCwd } from "./resume-cache.ts";
import { tmuxHasSession } from "./tmux.ts";

// Persistent, env-overridable. Never default to /tmp: it is cleared on reboot
// (systemd-tmpfiles), which silently destroys every live session's worktree —
// including uncommitted work. config.ts owns this path for creation, project
// identity, sweeping, and maintenance.
export { WORKTREE_ROOT };

export type SessionWorktree = {
  repoRoot: string;
  branch: string;
  path: string;
};

/**
 * Sidecar marker directory recording which worktrees the sweeper provisioned.
 *
 * WORKTREE_ROOT is a shared directory on a developer's machine, and the sweeper
 * used to treat every entry in it as its own to delete. It is not: people park
 * hand-made worktrees, release checkouts and full clones there too, and those
 * have no tmux session, no registry row and usually no process sitting in them,
 * so they matched "stale" perfectly and were removed within a sweep of being
 * created. (Observed 2026-08-08: `vibes-frontdoor` and `vibes-lfgpin`, both
 * hand-made worktrees of ~/repos/vibes, reaped 22 minutes apart.)
 *
 * The marker lives OUTSIDE the worktree so it never shows up as an untracked
 * file — which `captureWorktreeSnapshot` below would otherwise fold into the
 * WIP commit it takes before removal — and so it cannot dirty a branch a
 * session is about to push.
 */
const OWNED_DIR = `${WORKTREE_ROOT}/.lfg-owned`;

function ownedMarkerPath(name: string): string {
  return `${OWNED_DIR}/${name}`;
}

function markWorktreeOwned(name: string): void {
  try {
    mkdirSync(OWNED_DIR, { recursive: true });
    writeFileSync(ownedMarkerPath(name), `${Date.now()}\n`);
  } catch {
    // Best effort. A marker we failed to write means the sweeper leaves the
    // worktree alone forever, which leaks a directory — the safe direction.
  }
}

function isWorktreeOwned(name: string): boolean {
  return existsSync(ownedMarkerPath(name));
}

function clearWorktreeOwned(name: string): void {
  try {
    rmSync(ownedMarkerPath(name), { force: true });
  } catch {}
}

/**
 * Every git call here is awaited rather than spawnSync'd.
 *
 * Provisioning a worktree is 4-6 git processes, and `git worktree add` alone
 * copies a working tree to disk. Run synchronously they freeze Bun's single
 * event loop for the whole sequence, so one person clicking "new session"
 * stalls every other session's live stream. Awaiting yields between calls: the
 * create still takes what it takes, but nothing else in the server waits on it.
 */
async function git(
  repo: string,
  args: string[],
  opts?: { timeoutMs?: number; env?: Record<string, string | undefined> },
): Promise<{ ok: boolean; out: string; err: string }> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", repo, ...args],
    stdout: "pipe",
    stderr: "pipe",
    // Only set when a caller needs to redirect git's index (the WIP capture
    // below does, so it can stage a snapshot without touching the worktree's
    // real index). Omitting the key entirely inherits process.env unchanged.
    ...(opts?.env ? { env: { ...process.env, ...opts.env } } : {}),
  });
  const timer = opts?.timeoutMs ? setTimeout(() => proc.kill(), opts.timeoutMs) : null;
  try {
    const [out, err, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: exitCode === 0, out, err };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function isGitRepo(path: string): Promise<boolean> {
  return (await git(resolve(path), ["rev-parse", "--git-dir"])).ok;
}

async function hasHeadCommit(path: string): Promise<boolean> {
  return (await git(resolve(path), ["rev-parse", "--verify", "--quiet", "HEAD"])).ok;
}

export function sessionWorktreeEnabled(): boolean {
  return process.env.LFG_SESSION_WORKTREE !== "0";
}

export async function shouldAutoWorktree(
  repoRoot: string,
  opts?: { worktree?: boolean; selfRepo?: string },
): Promise<boolean> {
  const abs = resolve(repoRoot);
  const isSelfRepo = !!opts?.selfRepo && resolve(opts.selfRepo) === abs;
  // Shared-checkout opt-out remains available for ordinary projects, but not
  // for LFG itself: allowing one API caller to set worktree=false would reopen
  // the exact multi-session data-loss path this isolation is meant to close.
  if (opts?.worktree === false && !isSelfRepo) return false;
  // Explicit `worktree: true` is a hard opt-in: it overrides the default-off
  // guards (global disable) so an agent asked to
  // isolate ALWAYS lands in /tmp/lfg-wt instead of editing a shared checkout in
  // place. This is what lets an lfg subagent safely rewrite serve.ts/App.tsx
  // without colliding with the ~15 sessions live in the shared tree.
  if (opts?.worktree === true) return await isGitRepo(abs);
  // Otherwise fall back to the auto policy: on by default, including LFG's own
  // repository. The old self-repo exception let concurrent LFG sessions edit
  // and deploy the same checkout, so the last finisher silently erased earlier
  // work. `selfRepo` now strengthens rather than weakens the isolation policy.
  if (!sessionWorktreeEnabled()) return false;
  // "Use this folder" can initialize an existing directory as an unborn Git
  // repository. There is no commit from which Git can create a worktree yet,
  // but the first coding agent still needs to launch so it can inspect the
  // existing files and make that commit. Run that first session in place;
  // subsequent sessions regain normal worktree isolation once HEAD exists.
  return (await isGitRepo(abs)) && (await hasHeadCommit(abs));
}

// Refreshing origin/main before branching is a NETWORK round trip. It used to
// run synchronously on the session-create path, where it cost ~208ms on a good
// link, unbounded on a bad one, and froze Bun's single event loop for the whole
// round trip.
//
// It is now off the create path entirely: the refresh is started in the
// background and never awaited, so a create branches from the main already on
// disk and the fetch it kicks off benefits the *next* one.
//
// That is safe for the same reason skipping was: worktreeBaseRef below picks
// whichever main ref exists and prefers a local main that is ahead, so the
// worst case is a base up to a TTL old — one rebase away, and exactly what a
// create a minute earlier would have produced anyway. The TTL still collapses a
// burst of creates (or a fork, which creates through its own internal request)
// into one fetch, and the timeout still stops an unreachable remote from
// leaving a git process wedged behind us.
const FETCH_MAIN_TTL_MS = 60_000;
const FETCH_MAIN_TIMEOUT_MS = 10_000;
const lastMainFetchAt = new Map<string, number>();

function refreshMainInBackground(repo: string): void {
  const now = Date.now();
  const last = lastMainFetchAt.get(repo);
  if (last !== undefined && now - last < FETCH_MAIN_TTL_MS) return;
  // Recorded BEFORE the call, so a remote that times out is retried on the same
  // TTL as one that succeeds. Otherwise every create during an outage would pay
  // the full timeout again.
  lastMainFetchAt.set(repo, now);
  void git(repo, ["fetch", "--quiet", "origin", "main"], {
    timeoutMs: FETCH_MAIN_TIMEOUT_MS,
  }).catch(() => {});
}

async function worktreeBaseRef(
  repo: string,
): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  // Independent lookups, so they run concurrently rather than one after the
  // other — two git boots in the time of one.
  const [remoteMain, localMain] = await Promise.all([
    git(repo, ["rev-parse", "--verify", "--quiet", MAIN_REF]),
    git(repo, ["rev-parse", "--verify", "--quiet", "main"]),
  ]);

  if (localMain.ok) {
    if (!remoteMain.ok) return { ok: true, ref: "main" };
    const ahead = await git(repo, ["rev-list", "--count", `${MAIN_REF}..main`]);
    if (ahead.ok && parseInt(ahead.out.trim(), 10) > 0) return { ok: true, ref: "main" };
    return { ok: true, ref: MAIN_REF };
  }
  if (remoteMain.ok) return { ok: true, ref: MAIN_REF };

  // Imported local repositories may use another default branch. A real HEAD is
  // sufficient; an unborn repository is not, because Git cannot make a
  // worktree without a commit to branch from.
  const head = await git(repo, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (head.ok) return { ok: true, ref: "HEAD" };
  return { ok: false, error: "repository has no commits; create an initial commit first" };
}

// Create (or reuse) a per-session worktree from the newest usable main ref.
export async function prepareSessionWorktree(
  repoRoot: string,
  sessionName: string,
): Promise<{ ok: true; worktree: SessionWorktree } | { ok: false; error: string }> {
  const absRoot = resolve(repoRoot);
  const branch = `session_${sessionName}`;
  const wtPath = `${WORKTREE_ROOT}/${sessionName}`;

  mkdirSync(WORKTREE_ROOT, { recursive: true });

  if (existsSync(wtPath)) {
    // Backfill: a worktree provisioned before ownership markers existed is
    // still ours, and re-marking it on reuse lets it be reclaimed normally
    // instead of leaking forever.
    markWorktreeOwned(sessionName);
    return { ok: true, worktree: { repoRoot: absRoot, branch, path: wtPath } };
  }

  refreshMainInBackground(absRoot);

  // Base the worktree on whichever main is newer. Brand-new projects have no
  // remote yet, so local main must be a complete path rather than a fallback
  // that still assumes origin/main exists.
  const base = await worktreeBaseRef(absRoot);
  if (!base.ok) return base;

  const add = await git(absRoot, ["worktree", "add", "-b", branch, wtPath, base.ref]);
  if (!add.ok) {
    const reuseBranch = await git(absRoot, ["worktree", "add", wtPath, branch]);
    if (!reuseBranch.ok) {
      return {
        ok: false,
        error: add.err.trim() || reuseBranch.err.trim() || "git worktree add failed",
      };
    }
  }

  markWorktreeOwned(sessionName);
  return { ok: true, worktree: { repoRoot: absRoot, branch, path: wtPath } };
}

export async function resolveSessionCwd(
  repoRoot: string,
  sessionName: string,
  opts?: { worktree?: boolean; selfRepo?: string },
): Promise<
  | { ok: true; cwd: string; worktree?: SessionWorktree }
  | { ok: false; error: string }
> {
  if (!(await shouldAutoWorktree(repoRoot, opts))) {
    return { ok: true, cwd: resolve(repoRoot) };
  }
  const wt = await prepareSessionWorktree(repoRoot, sessionName);
  if (!wt.ok) return { ok: false, error: wt.error };
  return { ok: true, cwd: wt.worktree.path, worktree: wt.worktree };
}

async function repoRootFromWorktree(wtPath: string): Promise<string | null> {
  const r = await git(wtPath, ["rev-parse", "--git-common-dir"]);
  if (!r.ok) return null;
  const common = resolve(wtPath, r.out.trim());
  return dirname(common);
}

export type WorktreeCapture = {
  /** `refs/wip/<name>` — a GC root, so it outlives the worktree and the branch. */
  ref: string;
  commit: string;
  /** False when the capture is byte-identical to HEAD (nothing to lose). */
  hadChanges: boolean;
};

export type WorktreeRemoval =
  | { ok: true; capture: WorktreeCapture | null }
  | { ok: false; stage: "capture" | "remove"; error: string };

/**
 * Snapshot a worktree's exact working-tree contents into a real commit,
 * reachable forever via `refs/wip/<name>`, before anything is allowed to
 * remove it.
 *
 * Why a commit and not a diff: a diff misses untracked files entirely (the
 * file someone wrote but never `git add`ed is the work most worth keeping),
 * drops file modes and binary content, and rots the moment its base commit is
 * gone. A commit under a ref needs none of that context back — `git worktree
 * add <path> refs/wip/<name>` alone reconstructs it, and refs are GC roots so
 * `git gc` will never collect it.
 *
 * Runs against a SCRATCH index (GIT_INDEX_FILE), never the worktree's real
 * one: a failed capture must leave the worktree exactly as a caller found it,
 * because callers keep it on failure and this must never be the reason a
 * concurrent operation on the same worktree gets confused. `add -A` (not
 * `-A -f`) respects .gitignore, so node_modules/build output/data caches stay
 * out of the snapshot — this preserves work, not the disk hog we're trying to
 * reclaim.
 */
async function captureWorktreeSnapshot(
  repoRoot: string,
  wtPath: string,
  name: string,
): Promise<{ ok: true; capture: WorktreeCapture } | { ok: false; error: string }> {
  const head = await git(wtPath, ["rev-parse", "HEAD"], { timeoutMs: 10_000 });
  if (!head.ok) return { ok: false, error: head.err.trim() || "no HEAD to capture against" };
  const headSha = head.out.trim();

  const scratchIndex = join(tmpdir(), `lfg-wip-index-${name}-${randomBytes(4).toString("hex")}`);
  const env = { GIT_INDEX_FILE: scratchIndex };
  try {
    const readTree = await git(wtPath, ["read-tree", headSha], { env, timeoutMs: 15_000 });
    if (!readTree.ok) return { ok: false, error: readTree.err.trim() || "read-tree failed" };

    const add = await git(wtPath, ["add", "-A"], { env, timeoutMs: 30_000 });
    if (!add.ok) return { ok: false, error: add.err.trim() || "add -A failed" };

    const writeTree = await git(wtPath, ["write-tree"], { env, timeoutMs: 15_000 });
    if (!writeTree.ok) return { ok: false, error: writeTree.err.trim() || "write-tree failed" };
    const treeSha = writeTree.out.trim();

    const headTree = await git(wtPath, ["rev-parse", `${headSha}^{tree}`], { timeoutMs: 10_000 });
    const hadChanges = !headTree.ok || headTree.out.trim() !== treeSha;

    const refName = `refs/wip/${name}`;
    const message =
      `WIP capture before worktree reclaim: ${name}\n\n` +
      `Automatic snapshot taken because this worktree's retention window\n` +
      `expired. Contains tracked modifications, staged changes, and untracked\n` +
      `files exactly as they stood at removal; gitignored paths are excluded.\n\n` +
      `Restore with:\n  git -C ${repoRoot} worktree add <path> ${refName}\n`;
    const commitTree = await git(wtPath, ["commit-tree", treeSha, "-p", headSha, "-m", message], {
      timeoutMs: 10_000,
    });
    if (!commitTree.ok) return { ok: false, error: commitTree.err.trim() || "commit-tree failed" };
    const commitSha = commitTree.out.trim();

    const updateRef = await git(wtPath, ["update-ref", refName, commitSha], { timeoutMs: 10_000 });
    if (!updateRef.ok) return { ok: false, error: updateRef.err.trim() || "update-ref failed" };

    return { ok: true, capture: { ref: refName, commit: commitSha, hadChanges } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      rmSync(scratchIndex, { force: true });
    } catch {
      // The scratch index living on past its worktree costs a few KB in
      // /tmp; failing to clean it up must never fail the capture itself.
    }
  }
}

// Best-effort branch cleanup. Unmerged branches remain as the recovery copy. A
// branch already contained in main is stale state, so remove it after its
// worktree is gone and cannot need it as a checked-out ref.
//
// Capture MUST succeed before anything here calls `git worktree remove
// --force`, which deletes a dirty tree without asking. If capture fails for
// any reason, this returns `{ ok: false, stage: "capture" }` and the worktree
// is left untouched — never reclaim on the assumption a capture worked.
export async function removeSessionWorktree(
  repoRoot: string | null,
  sessionName: string,
): Promise<WorktreeRemoval> {
  const wtPath = `${WORKTREE_ROOT}/${sessionName}`;
  if (!existsSync(wtPath)) {
    clearWorktreeOwned(sessionName);
    return { ok: true, capture: null };
  }
  const root = repoRoot ? resolve(repoRoot) : await repoRootFromWorktree(wtPath);
  if (!root) {
    return { ok: false, stage: "remove", error: "could not resolve the worktree's repo root" };
  }

  const captured = await captureWorktreeSnapshot(root, wtPath, sessionName);
  if (!captured.ok) return { ok: false, stage: "capture", error: captured.error };

  const removed = (await git(root, ["worktree", "remove", "--force", wtPath])).ok;
  if (!removed) return { ok: false, stage: "remove", error: "git worktree remove failed" };

  clearWorktreeOwned(sessionName);
  await deleteMergedSessionBranch(root, `session_${sessionName}`).catch(() => false);
  return { ok: true, capture: captured.capture };
}

export type WorktreeSweepResult = {
  scanned: number;
  /** Successfully captured (see `captures`) and removed. */
  removed: string[];
  kept: number;
  skippedYoung: number;
  /** `git worktree remove` itself failed after a successful capture. */
  failed: string[];
  /** Directories the sweeper did not provision, so may not delete. */
  unmanaged: string[];
  /** Removed worktrees whose capture found real uncommitted content (see `captures`). */
  dirty: string[];
  /** Held back because the worktree is still inside its retention window. */
  recentlyActive: string[];
  /**
   * Past retention and otherwise reclaimable, but the pre-removal capture
   * failed — kept rather than risk removing something that was never
   * actually saved. Needs a human look; it will not resolve itself.
   */
  captureFailed: string[];
  /** name -> where its pre-removal snapshot landed, for anyone restoring one. */
  captures: Record<string, WorktreeCapture>;
};

/**
 * Worktree directory names that a live process is currently sitting in.
 *
 * tmux and the managed registry are both only *proxies* for "this session is
 * alive", and both lie for harness backends (aisdk / codex-aisdk / opencode):
 * those run as bare processes with no tmux session, so `tmuxHasSession` is
 * always false and the registry is the single point of failure. When serve
 * restarts and session-recovery doesn't re-adopt one, the worktree of a
 * still-running agent looks stale and gets deleted underneath it — taking
 * uncommitted work with it.
 *
 * /proc/<pid>/cwd is the ground truth. Agent subprocesses (builds, tests) count
 * too, which is what we want. This can only ever KEEP a worktree, never remove
 * one, so a bad read degrades to the old behaviour rather than deleting more.
 */
function worktreesInUse(): Set<string> {
  const inUse = new Set<string>();
  const prefix = `${WORKTREE_ROOT}/`;
  let pids: string[];
  try {
    pids = readdirSync("/proc");
  } catch {
    return inUse; // not Linux — fall back to the tmux/registry checks alone
  }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    let cwd: string;
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      continue; // exited between readdir and readlink, or not ours to inspect
    }
    if (!cwd.startsWith(prefix)) continue;
    const name = cwd.slice(prefix.length).split("/")[0];
    if (name) inUse.add(name);
  }
  return inUse;
}

// One retention window for every owned worktree (2026-08-23 policy). Age no
// longer decides between "keep forever" and "reclaim" on its own — dirty
// worktrees do not get a special never-reap tier, because captureWorktreeSnapshot
// preserves their content before removal either way. Age only decides WHEN a
// worktree becomes eligible; three signals still decide whether it ever does,
// and none of them bend for age:
//   - a live tmux pane
//   - a live process whose cwd is inside the worktree
//   - still present in the session/managed registry
// Those are exactly the guards that all failed at once and let the sweeper
// destroy a live session's tree (incident: lfg-35973c, 2026-08-23). Capture
// makes a wrong reclaim recoverable; it does not make these three optional.
export async function sweepStaleWorktrees(opts?: {
  minAgeMs?: number;
  now?: number;
  retentionMs?: number;
}): Promise<WorktreeSweepResult> {
  const minAgeMs = opts?.minAgeMs ?? worktreeSweepMinAgeMs();
  const now = opts?.now ?? Date.now();
  const retentionMs = opts?.retentionMs ?? worktreeRetentionMs();
  const managed = new Set<string>();
  for (const m of listManaged()) {
    managed.add(m.tmuxName);
    managed.add(basename(m.cwd));
  }
  const inUse = worktreesInUse();
  const result: WorktreeSweepResult = {
    scanned: 0,
    removed: [],
    kept: 0,
    skippedYoung: 0,
    failed: [],
    unmanaged: [],
    dirty: [],
    recentlyActive: [],
    captureFailed: [],
    captures: {},
  };

  if (!existsSync(WORKTREE_ROOT)) return result;

  for (const name of readdirSync(WORKTREE_ROOT)) {
    // Dotfiles are bookkeeping (the ownership markers live here), never
    // worktrees.
    if (name.startsWith(".")) continue;
    const wtPath = `${WORKTREE_ROOT}/${name}`;
    let dirStat: ReturnType<typeof statSync>;
    try {
      dirStat = statSync(wtPath);
      if (!dirStat.isDirectory()) continue;
    } catch {
      continue;
    }
    result.scanned++;

    // The sweeper may only delete what the sweeper created. Everything else in
    // this directory belongs to a human. (Directories that look like worktrees
    // but are not registered with any repo are a separate, non-code-owned
    // category — see scripts/worktree-reclaim-report.ts.)
    if (!isWorktreeOwned(name)) {
      result.unmanaged.push(name);
      continue;
    }

    // HARD BLOCKS. Unconditional — age must never outvote these three, because
    // these are exactly the checks that all missed at once on 2026-08-23 and
    // destroyed a live session's worktree.
    if (tmuxHasSession(name) || managed.has(name) || inUse.has(name)) {
      result.kept++;
      continue;
    }

    // Tiny creation-race guard, unrelated to retention policy: a worktree is
    // created a moment before tmux new-session (or the managed row) returns,
    // so a worktree younger than this cannot yet have any of the three hard
    // blocks above set even though a session is actively starting in it.
    if (now - dirStat.mtimeMs < minAgeMs) {
      result.skippedYoung++;
      continue;
    }

    // Retention clock. The resume-cache's last_activity_at is a real
    // transcript-derived timestamp and a far better clock than the worktree
    // directory's own mtime (which only moves when something touches the
    // worktree root directly, not when a session edits a file three levels
    // deep) — use it whenever this cwd has an entry, and fall back to
    // directory mtime only when it does not. Either way, "not sure" resolves
    // to "more recent", never less: that only ever makes the sweeper wait
    // longer, which is the safe direction.
    let referenceMs = dirStat.mtimeMs;
    let recentSignal = false;
    try {
      const cached = lastActivityAtForCwd(wtPath);
      if (cached !== null) {
        referenceMs = cached;
        recentSignal = true;
      }
    } catch {
      // An unreadable cache must never widen what the sweeper reclaims.
    }
    if (now - referenceMs < retentionMs) {
      if (recentSignal) result.recentlyActive.push(name);
      continue;
    }

    // Past the retention window. Capture first, unconditionally — dirty or
    // clean gets the same treatment now, per the 2026-08-23 policy: nothing is
    // lost when the window expires, so age alone is enough to reclaim.
    const removal = await removeSessionWorktree(null, name);
    if (removal.ok) {
      result.removed.push(name);
      if (removal.capture) {
        result.captures[name] = removal.capture;
        if (removal.capture.hadChanges) result.dirty.push(name);
      }
    } else if (removal.stage === "capture") {
      // Never reclaim on the assumption a capture worked. Keep it and surface
      // it — this needs a human, not a retry loop, since the same failure
      // (permissions, a git object-store problem) will likely recur.
      result.captureFailed.push(name);
    } else {
      result.failed.push(name);
    }
  }

  return result;
}

function worktreeSweepIntervalMs(): number {
  const raw = process.env.LFG_WORKTREE_SWEEP_MS;
  if (raw === "0") return 0;
  const n = raw ? parseInt(raw, 10) : 15 * 60_000;
  return Number.isFinite(n) && n > 0 ? n : 15 * 60_000;
}

function worktreeSweepMinAgeMs(): number {
  const raw = process.env.LFG_WORKTREE_SWEEP_MIN_AGE_MS;
  const n = raw ? parseInt(raw, 10) : 2 * 60_000;
  return Number.isFinite(n) && n >= 0 ? n : 2 * 60_000;
}

// How long a worktree may sit past its last known activity before the sweeper
// captures and reclaims it. One window for every worktree, dirty or clean —
// captureWorktreeSnapshot is what makes that safe, not the length of the
// window. Seven days: the data behind this default (2026-08-23) showed 77 of
// 80 worktrees already over 2 days idle, so most reasonable windows reclaim
// most of the current backlog; seven gives a generous margin for someone who
// stepped away for a few days and still means to come back, while a captured
// worktree costs kilobytes to keep around if the window turns out to be
// wrong in either direction.
function worktreeRetentionMs(): number {
  const raw = process.env.LFG_WORKTREE_RETENTION_MS;
  const fallback = 7 * 24 * 60 * 60_000;
  const n = raw ? parseInt(raw, 10) : fallback;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let sweeping = false;

export function startWorktreeSweep(onLog: (s: string) => void = () => {}): void {
  const intervalMs = worktreeSweepIntervalMs();
  if (!sessionWorktreeEnabled() || intervalMs === 0) return;
  if (sweepTimer) return;

  const run = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      const r = await sweepStaleWorktrees();
      if (r.removed.length || r.failed.length || r.captureFailed.length) {
        onLog(
          `[worktree-sweep] scanned=${r.scanned} removed=${r.removed.length}` +
            (r.removed.length ? ` [${r.removed.join(", ")}]` : "") +
            (r.dirty.length ? ` captured-uncommitted=[${r.dirty.join(", ")}]` : "") +
            (r.failed.length ? ` failed=[${r.failed.join(", ")}]` : "") +
            (r.captureFailed.length
              ? ` capture-failed=[${r.captureFailed.join(", ")}] (kept, needs a human look)`
              : "") +
            (r.recentlyActive.length ? ` within-retention=${r.recentlyActive.length}` : ""),
        );
      }
    } catch (e) {
      onLog(`[worktree-sweep] error: ${e}`);
    } finally {
      sweeping = false;
    }
  };

  sweepTimer = setInterval(run, intervalMs);
  // The startup sweep used to fire 30s after boot — the single worst moment to
  // run it. serve restarts often (14 times in one two-hour stretch), and every
  // restart re-armed it, so the *effective* cadence was "once per restart",
  // not the advertised 15 minutes. Worse, 30s in is when session recovery has
  // not finished re-adopting sessions, so the managed registry is at its
  // emptiest and the most worktrees look abandoned. Every multi-worktree
  // removal in the observed logs happened within 40s of a start; the steady
  // 15-minute sweeps removed nothing. Wait for the registry to warm up.
  const startupDelayMs = Math.min(intervalMs, 5 * 60_000);
  setTimeout(run, startupDelayMs);
  onLog(
    `[worktree-sweep] started (every ${Math.round(intervalMs / 60_000)}m, min-age ${Math.round(worktreeSweepMinAgeMs() / 1000)}s, retention ${Math.round(worktreeRetentionMs() / 86_400_000)}d)`,
  );
}
