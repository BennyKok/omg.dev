// Auto-provision an isolated git worktree per lfg-managed session so agents
// never collide on a shared checkout (see docs/repo-hygiene.md). Voice-only
// orchestrator sessions are the lone automatic exception.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { WORKTREE_ROOT, worktreeRoots } from "./config.ts";
import { MAIN_REF } from "./agents/collectors/git-fresh.ts";
import { listManagedWithArchive } from "./managed.ts";
import { deleteMergedSessionBranch } from "./project-maintenance.ts";
import { lastActivityAtForCwd } from "./resume-cache.ts";
import { tmuxHasSession } from "./tmux.ts";
import {
  createSnapfork,
  ensureSnapforkMounted,
  isSnapfork,
  removeSnapforkLayer,
  snapforkEnabled,
  sweepOrphanForks,
  sweepUnusedBases,
} from "./snapfork.ts";

// Persistent, env-overridable. Never default to /tmp: it is cleared on reboot
// (systemd-tmpfiles), which silently destroys every live session's worktree —
// including uncommitted work. config.ts owns this path for creation, project
// identity, sweeping, and maintenance.
export { WORKTREE_ROOT, worktreeRoots };

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
function ownedDir(root: string): string {
  return `${root}/.lfg-owned`;
}

function ownedMarkerPath(name: string, root: string): string {
  return `${ownedDir(root)}/${name}`;
}

function markWorktreeOwned(name: string, root: string): void {
  try {
    mkdirSync(ownedDir(root), { recursive: true });
    writeFileSync(ownedMarkerPath(name, root), `${Date.now()}\n`);
  } catch {
    // Best effort. A marker we failed to write means the sweeper leaves the
    // worktree alone forever, which leaks a directory — the safe direction.
  }
}

function isWorktreeOwned(name: string, root: string): boolean {
  return existsSync(ownedMarkerPath(name, root));
}

function clearWorktreeOwned(name: string, root: string): void {
  try {
    rmSync(ownedMarkerPath(name, root), { force: true });
  } catch {}
}

/** An existing session directory on the create root or any legacy root. */
export function findSessionWorktree(sessionName: string): { root: string; path: string } | null {
  for (const root of worktreeRoots()) {
    const path = `${root}/${sessionName}`;
    if (existsSync(path)) return { root, path };
  }
  return null;
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

  mkdirSync(WORKTREE_ROOT, { recursive: true });

  const existing = findSessionWorktree(sessionName);
  if (existing) {
    // Backfill: a worktree provisioned before ownership markers existed is
    // still ours, and re-marking it on reuse lets it be reclaimed normally
    // instead of leaking forever. Reuse the directory it already lives in so
    // moving WORKTREE_ROOT does not clone a second copy.
    markWorktreeOwned(sessionName, existing.root);
    // A fork's FUSE daemon does not survive a reboot. Mount it again before
    // anyone runs in the directory, or they would see an empty checkout.
    if (isSnapfork(sessionName, existing.root)) await ensureSnapforkMounted(sessionName, existing.root);
    return { ok: true, worktree: { repoRoot: absRoot, branch, path: existing.path } };
  }

  const wtPath = `${WORKTREE_ROOT}/${sessionName}`;

  refreshMainInBackground(absRoot);

  // Base the worktree on whichever main is newer. Brand-new projects have no
  // remote yet, so local main must be a complete path rather than a fallback
  // that still assumes origin/main exists.
  const base = await worktreeBaseRef(absRoot);
  if (!base.ok) return base;

  // Opt-in (LFG_SNAPFORK=1): mount the session over a shared base checkout
  // instead of writing a full one. Any outcome other than a working fork or a
  // checked-out fallback drops through to the normal path below.
  if (snapforkEnabled()) {
    const startedAt = performance.now();
    const fork = await createSnapfork({ repo: absRoot, name: sessionName, branch, ref: base.ref, wtPath });
    // One line per create, for the trial review: `journalctl --user -u lfg | grep '\[snapfork\]'`.
    console.log(
      `[snapfork] create ${sessionName} repo=${basename(absRoot)} outcome=${fork.kind}` +
        ` ms=${Math.round(performance.now() - startedAt)}` +
        (fork.kind === "plain" ? ` reason=${JSON.stringify(fork.reason.slice(0, 200))}` : "") +
        (fork.kind === "error" ? ` error=${JSON.stringify(fork.error.slice(0, 200))}` : ""),
    );
    if (fork.kind === "snapfork" || fork.kind === "plain") {
      markWorktreeOwned(sessionName, WORKTREE_ROOT);
      return { ok: true, worktree: { repoRoot: absRoot, branch, path: wtPath } };
    }
  }

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

  markWorktreeOwned(sessionName, WORKTREE_ROOT);
  return { ok: true, worktree: { repoRoot: absRoot, branch, path: wtPath } };
}

/**
 * Where a new session will run, decided without creating anything.
 *
 * Session create answers before the checkout exists: `git worktree add` costs
 * seconds on a loaded box, and the person should see their session at once.
 * This returns the path prepareSessionWorktree is going to create for a fresh
 * session name, so the managed record can carry its final cwd from the start.
 */
export async function planSessionCwd(
  repoRoot: string,
  sessionName: string,
  opts?: { worktree?: boolean; selfRepo?: string },
): Promise<{ cwd: string; worktree?: SessionWorktree }> {
  if (!(await shouldAutoWorktree(repoRoot, opts))) return { cwd: resolve(repoRoot) };
  const existing = findSessionWorktree(sessionName);
  const path = existing?.path ?? `${WORKTREE_ROOT}/${sessionName}`;
  return {
    cwd: path,
    worktree: { repoRoot: resolve(repoRoot), branch: `session_${sessionName}`, path },
  };
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
const CAPTURE_IDENTITY = {
  GIT_AUTHOR_NAME: "omg.dev worktree sweep",
  GIT_AUTHOR_EMAIL: "worktree-sweep@omg.dev.invalid",
  GIT_COMMITTER_NAME: "omg.dev worktree sweep",
  GIT_COMMITTER_EMAIL: "worktree-sweep@omg.dev.invalid",
};

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
    // The snapshot is machine-authored, so it carries a fixed identity rather
    // than whatever the repo has configured. A repo with no user.email (a
    // bare `git init` project, and this box has no global identity) made
    // commit-tree fail with "Author identity unknown" on every pass, so its
    // worktrees sat in capture-failed forever: 19 of them on 2026-10-23.
    const commitTree = await git(wtPath, ["commit-tree", treeSha, "-p", headSha, "-m", message], {
      timeoutMs: 10_000,
      env: CAPTURE_IDENTITY,
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
  worktreeRoot?: string,
): Promise<WorktreeRemoval> {
  const located = worktreeRoot
    ? { root: worktreeRoot, path: `${worktreeRoot}/${sessionName}` }
    : findSessionWorktree(sessionName);
  const ownerRoot = located?.root ?? worktreeRoot ?? WORKTREE_ROOT;
  const wtPath = located?.path ?? `${ownerRoot}/${sessionName}`;
  if (!existsSync(wtPath)) {
    clearWorktreeOwned(sessionName, ownerRoot);
    return { ok: true, capture: null };
  }
  const repo = repoRoot ? resolve(repoRoot) : await repoRootFromWorktree(wtPath);
  if (!repo) {
    return { ok: false, stage: "remove", error: "could not resolve the worktree's repo root" };
  }

  const captured = await captureWorktreeSnapshot(repo, wtPath, sessionName);
  if (!captured.ok) return { ok: false, stage: "capture", error: captured.error };

  if (isSnapfork(sessionName, ownerRoot)) {
    // `git worktree remove` would delete every file through the mount, one
    // whiteout at a time. Unmount and drop the layer instead; the capture
    // above already holds the work.
    const layer = await removeSnapforkLayer(sessionName, ownerRoot);
    if (!layer.ok) return { ok: false, stage: "remove", error: layer.error };
    await git(repo, ["worktree", "prune"], { timeoutMs: 30_000 });
  } else {
    const removed = (await git(repo, ["worktree", "remove", "--force", wtPath])).ok;
    if (!removed) return { ok: false, stage: "remove", error: "git worktree remove failed" };
  }

  clearWorktreeOwned(sessionName, ownerRoot);
  await deleteMergedSessionBranch(repo, `session_${sessionName}`).catch(() => false);
  return { ok: true, capture: captured.capture };
}

/**
 * Why the sweeper kept or removed one directory. A dry run reports exactly
 * these, from the same code path a real pass uses, so the preview cannot drift
 * from what the timer will do.
 */
export type WorktreeKeepReason =
  /** No ownership marker and not on this name's `session_<name>` branch. */
  | "unowned"
  /** `.git` is a directory: a main checkout or a full clone, never a session worktree. */
  | "main-checkout"
  /** Resolves (through a symlink) to somewhere outside the worktree root. */
  | "outside-root"
  /** `.git` points at worktree metadata that no longer exists. */
  | "unregistered"
  /** `git worktree lock` was set by someone on purpose. */
  | "locked"
  | "current-process"
  | "tmux"
  | "managed"
  | "in-use"
  | "young"
  | "within-retention"
  /** Uncommitted, staged, or untracked (non-ignored) files. */
  | "dirty"
  /** The checked-out commit has work that is not on the upstream main. */
  | "unmerged"
  /** Git could not answer one of the questions above. Unknown keeps. */
  | "git-error"
  /** Eligible, but this pass already reached its removal limit. */
  | "deferred"
  | "capture-failed"
  | "remove-failed";

export type WorktreeDecision = {
  name: string;
  path: string;
  /** `remove` in a dry run means "a real pass would remove this". */
  action: "remove" | "keep";
  reason: WorktreeKeepReason | "removable";
  /** Newest activity signal used for the retention clock, epoch ms. */
  lastActivityMs?: number;
  repoRoot?: string;
};

export type WorktreeSweepResult = {
  scanned: number;
  dryRun: boolean;
  /** Successfully captured (see `captures`) and removed. Empty in a dry run. */
  removed: string[];
  /** Dry run only: what a real pass would remove, before the per-pass limit. */
  removable: string[];
  /** Held by a live signal: tmux, the managed registry, a process cwd, or this process. */
  kept: number;
  skippedYoung: number;
  /** `git worktree remove` itself failed after a successful capture. */
  failed: string[];
  /** Directories the sweeper did not provision, so may not delete. */
  unmanaged: string[];
  /** Past retention but holding uncommitted or untracked work. Kept. */
  dirty: string[];
  /** Past retention but the branch has commits not on upstream main. Kept. */
  unmerged: string[];
  /** Held back because the worktree is still inside its retention window. */
  recentlyActive: string[];
  /** Eligible but over this pass's removal limit; the next pass takes them. */
  deferred: string[];
  /**
   * Past retention and otherwise reclaimable, but the pre-removal capture
   * failed — kept rather than risk removing something that was never
   * actually saved. Needs a human look; it will not resolve itself.
   */
  captureFailed: string[];
  /** name -> where its pre-removal snapshot landed, for anyone restoring one. */
  captures: Record<string, WorktreeCapture>;
  /** One entry per scanned directory. */
  decisions: WorktreeDecision[];
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
  const prefixes = worktreeRoots().map((root) => `${root}/`);
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
    const prefix = prefixes.find((candidate) => cwd.startsWith(candidate));
    if (!prefix) continue;
    const name = cwd.slice(prefix.length).split("/")[0];
    if (name) inUse.add(name);
  }
  return inUse;
}


type GitPointer =
  | { kind: "missing" }
  | { kind: "checkout" }
  | { kind: "linked"; gitdir: string; registered: boolean };

/** Read `<wt>/.git` without spawning git. A directory means a real checkout. */
function readGitPointer(wtPath: string): GitPointer {
  const dotGit = join(wtPath, ".git");
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(dotGit);
  } catch {
    return { kind: "missing" };
  }
  if (st.isDirectory()) return { kind: "checkout" };
  try {
    const raw = readFileSync(dotGit, "utf8").trim();
    const match = raw.match(/^gitdir:\s*(.+)$/m);
    if (!match) return { kind: "missing" };
    const gitdir = resolve(wtPath, match[1]!.trim());
    return { kind: "linked", gitdir, registered: existsSync(join(gitdir, "HEAD")) };
  } catch {
    return { kind: "missing" };
  }
}

function mtimeOr(path: string, fallback: number): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return fallback;
  }
}

function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

/**
 * The ref that counts as "landed". origin/main is the landing target; a repo
 * with no remote (a local `git init` project) lands on its local main. A stale
 * origin/main can only make a merged branch look unmerged, which keeps it.
 */
async function upstreamMainRef(wtPath: string): Promise<string | null> {
  for (const ref of [MAIN_REF, "refs/remotes/origin/HEAD", "refs/heads/main", "refs/heads/master"]) {
    const r = await git(wtPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (r.ok) return ref;
  }
  return null;
}

function nulList(out: string): string[] {
  return out.split("\0").filter(Boolean);
}

/**
 * Whether everything the worktree's HEAD carries is already on upstream main.
 *
 * Read-only on purpose (no merge-tree, which writes objects), so a dry run can
 * call it against real repositories. Three ways a branch counts as landed:
 *   1. HEAD is an ancestor of main: never diverged, or merged/fast-forwarded.
 *   2. Every path the branch changed since the merge base is byte-identical
 *      in main. This is how a squash landing looks, and it is exactly the
 *      "nothing to lose" condition for those files.
 *   3. `git cherry` finds a patch-equivalent commit on main for every branch
 *      commit. This is how a rebase landing looks when main has since edited
 *      the same files again.
 * Anything else, including a git error, is "not landed", which keeps it.
 */
export async function worktreeLandedOnMain(
  wtPath: string,
): Promise<"landed" | "not-landed" | "error"> {
  const target = await upstreamMainRef(wtPath);
  if (!target) return "error";
  const head = await git(wtPath, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  if (!head.ok) return "error";
  if ((await git(wtPath, ["merge-base", "--is-ancestor", "HEAD", target])).ok) return "landed";

  const base = await git(wtPath, ["merge-base", target, "HEAD"]);
  if (!base.ok) return "not-landed"; // unrelated histories
  const changed = await git(wtPath, ["diff", "--name-only", "--no-renames", "-z", base.out.trim(), "HEAD"]);
  if (!changed.ok) return "error";
  const changedPaths = nulList(changed.out);
  if (changedPaths.length === 0) return "landed";
  const differs = await git(wtPath, ["diff", "--name-only", "--no-renames", "-z", target, "HEAD"]);
  if (!differs.ok) return "error";
  const differing = new Set(nulList(differs.out));
  if (!changedPaths.some((p) => differing.has(p))) return "landed";

  const cherry = await git(wtPath, ["cherry", target, "HEAD"], { timeoutMs: 30_000 });
  if (!cherry.ok) return "error";
  const lines = cherry.out.split("\n").filter(Boolean);
  if (lines.length > 0 && lines.every((l) => l.startsWith("-"))) return "landed";
  return "not-landed";
}

/**
 * Uncommitted, staged, or untracked work. Ignored files (node_modules, build
 * output, data caches) do not count. `--no-optional-locks` stops status from
 * rewriting the index, so checking does not reset the idle clock either.
 */
async function worktreeIsDirty(wtPath: string): Promise<boolean | null> {
  const r = await git(wtPath, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=normal"], {
    timeoutMs: 30_000,
  });
  if (!r.ok) return null;
  return r.out.trim().length > 0;
}

function readSessionBranch(gitdir: string): string | null {
  try {
    const head = readFileSync(join(gitdir, "HEAD"), "utf8").trim();
    return head.startsWith("ref: refs/heads/") ? head.slice("ref: refs/heads/".length) : null;
  } catch {
    return null;
  }
}

// What may be removed (2026-10-23 policy). A worktree is removed only when
// removing it loses nothing. Every one of these must hold:
//   - the sweeper owns it: an ownership marker, or it is checked out on
//     `session_<name>` at `<root>/<name>`, the exact shape
//     prepareSessionWorktree creates (pre-marker session worktrees)
//   - it is a linked worktree, not a main checkout or clone, and it resolves
//     inside the worktree root
//   - no live signal: a tmux pane, a managed registry row (any state, so
//     launching and hydrating rows count), a process cwd inside it, or this
//     process's own cwd. Age never outvotes these (incident lfg-35973c,
//     2026-08-23).
//   - idle past the retention window, by the NEWEST of the directory mtime,
//     the worktree's git index, HEAD and reflog, and the resume cache's
//     transcript activity
//   - clean: no tracked, staged, or untracked changes (ignored files aside)
//   - landed: HEAD has nothing that upstream main lacks (worktreeLandedOnMain)
// Dirty or unlanded worktrees are kept and reported. The 2026-08-23 policy
// captured and removed those too; it is narrowed because a capture ref is a
// recovery path, not a reason to delete work. The capture still runs before
// every removal as a guard against a file written between the check and the
// removal.
//
// A resumed session does not need its old worktree: resolveResumeCwd in
// serve.ts falls back to the project checkout when the directory is gone, and
// a landed branch holds nothing that checkout lacks.
export async function sweepStaleWorktrees(opts?: {
  minAgeMs?: number;
  now?: number;
  retentionMs?: number;
  /** Decide everything, remove nothing. */
  dryRun?: boolean;
  /** Most removals in one pass, so a backlog never saturates disk IO. */
  maxRemovals?: number;
}): Promise<WorktreeSweepResult> {
  const minAgeMs = opts?.minAgeMs ?? worktreeSweepMinAgeMs();
  const now = opts?.now ?? Date.now();
  const retentionMs = opts?.retentionMs ?? worktreeRetentionMs();
  const dryRun = opts?.dryRun === true;
  const maxRemovals = opts?.maxRemovals ?? worktreeSweepMaxRemovals();
  const managed = new Set<string>();
  // Retired rows protect their worktree exactly as they did while live, so
  // registry retirement never makes a resumable session's tree reclaimable.
  for (const m of listManagedWithArchive()) {
    managed.add(m.tmuxName);
    if (m.cwd) managed.add(basename(m.cwd));
  }
  const inUse = worktreesInUse();
  const ownCwd = realOrNull(process.cwd());
  const result: WorktreeSweepResult = {
    scanned: 0,
    dryRun,
    removed: [],
    removable: [],
    kept: 0,
    skippedYoung: 0,
    failed: [],
    unmanaged: [],
    dirty: [],
    unmerged: [],
    recentlyActive: [],
    deferred: [],
    captureFailed: [],
    captures: {},
    decisions: [],
  };

  const roots = worktreeRoots().filter((root) => existsSync(root));
  if (roots.length === 0) return result;
  const touchedRepos = new Set<string>();
  let removals = 0;

  for (const root of roots) {
    const realRoot = realOrNull(root) ?? root;
    for (const name of readdirSync(root)) {
      // Dotfiles are bookkeeping (the ownership markers live here), never
      // worktrees.
      if (name.startsWith(".")) continue;
      const wtPath = `${root}/${name}`;
      let dirStat: ReturnType<typeof statSync>;
      try {
        dirStat = statSync(wtPath);
        if (!dirStat.isDirectory()) continue;
      } catch {
        continue;
      }
      result.scanned++;
      const decide = (
        action: WorktreeDecision["action"],
        reason: WorktreeDecision["reason"],
        extra?: Partial<WorktreeDecision>,
      ) => {
        result.decisions.push({ name, path: wtPath, action, reason, ...extra });
      };

      const real = realOrNull(wtPath);
      if (!real || !isInside(real, realRoot) || real === realRoot) {
        decide("keep", "outside-root");
        continue;
      }
      if (ownCwd && isInside(ownCwd, real)) {
        result.kept++;
        decide("keep", "current-process");
        continue;
      }

      // An unmounted fork shows only its bare mountpoint. Mount it so the
      // checks below see the real files, exactly as for a normal worktree.
      if (isSnapfork(name, root)) await ensureSnapforkMounted(name, root);
      const pointer = readGitPointer(wtPath);
      if (pointer.kind === "checkout") {
        decide("keep", "main-checkout");
        continue;
      }
      // The sweeper may only delete what the sweeper created. Everything else
      // in this directory belongs to a human.
      const onSessionBranch =
        pointer.kind === "linked" && readSessionBranch(pointer.gitdir) === `session_${name}`;
      if (!isWorktreeOwned(name, root) && !onSessionBranch) {
        result.unmanaged.push(name);
        decide("keep", "unowned");
        continue;
      }
      if (pointer.kind !== "linked" || !pointer.registered) {
        decide("keep", "unregistered");
        continue;
      }
      if (existsSync(join(pointer.gitdir, "locked"))) {
        decide("keep", "locked");
        continue;
      }

      // HARD BLOCKS. Unconditional — age must never outvote these, because
      // these are exactly the checks that all missed at once on 2026-08-23 and
      // destroyed a live session's worktree.
      const live = managed.has(name)
        ? "managed"
        : inUse.has(name)
          ? "in-use"
          : tmuxHasSession(name)
            ? "tmux"
            : null;
      if (live) {
        result.kept++;
        decide("keep", live);
        continue;
      }

      // Tiny creation-race guard, unrelated to retention policy: a worktree is
      // created a moment before tmux new-session (or the managed row) returns.
      if (now - dirStat.mtimeMs < minAgeMs) {
        result.skippedYoung++;
        decide("keep", "young");
        continue;
      }

      // Retention clock: the newest signal wins. The resume cache records
      // transcript activity; the index, HEAD and reflog move on every
      // add/commit/checkout three directories deep, which the worktree's own
      // directory mtime does not. "Not sure" only ever reads as more recent.
      let lastActivityMs = Math.max(
        dirStat.mtimeMs,
        mtimeOr(join(pointer.gitdir, "index"), 0),
        mtimeOr(join(pointer.gitdir, "HEAD"), 0),
        mtimeOr(join(pointer.gitdir, "logs", "HEAD"), 0),
      );
      let cacheReadable = true;
      try {
        const cached = lastActivityAtForCwd(wtPath);
        if (cached !== null) lastActivityMs = Math.max(lastActivityMs, cached);
      } catch {
        cacheReadable = false; // must never widen what the sweeper reclaims
      }
      if (!cacheReadable || now - lastActivityMs < retentionMs) {
        result.recentlyActive.push(name);
        decide("keep", "within-retention", { lastActivityMs });
        continue;
      }

      const repoRoot = (await repoRootFromWorktree(wtPath)) ?? undefined;
      const facts = { lastActivityMs, repoRoot };
      const dirty = await worktreeIsDirty(wtPath);
      if (dirty === null) {
        decide("keep", "git-error", facts);
        continue;
      }
      if (dirty) {
        result.dirty.push(name);
        decide("keep", "dirty", facts);
        continue;
      }
      const landed = await worktreeLandedOnMain(wtPath);
      if (landed !== "landed") {
        if (landed === "not-landed") result.unmerged.push(name);
        decide("keep", landed === "not-landed" ? "unmerged" : "git-error", facts);
        continue;
      }

      if (dryRun) {
        result.removable.push(name);
        decide("remove", "removable", facts);
        continue;
      }
      if (removals >= maxRemovals) {
        result.deferred.push(name);
        decide("keep", "deferred", facts);
        continue;
      }
      removals++;
      const removal = await removeSessionWorktree(repoRoot ?? null, name, root);
      if (repoRoot) touchedRepos.add(repoRoot);
      if (removal.ok) {
        result.removed.push(name);
        if (removal.capture) result.captures[name] = removal.capture;
        decide("remove", "removable", facts);
      } else if (removal.stage === "capture") {
        // Never reclaim on the assumption a capture worked. Keep it and surface
        // it — this needs a human, not a retry loop.
        result.captureFailed.push(name);
        decide("keep", "capture-failed", facts);
      } else {
        result.failed.push(name);
        decide("keep", "remove-failed", facts);
      }
    }
  }

  // `worktree remove` already drops its own metadata. Prune clears entries
  // whose directory vanished some other way, so `git worktree list` and the
  // branch-in-use checks stay truthful. Git leaves locked entries alone.
  for (const repo of touchedRepos) {
    await git(repo, ["worktree", "prune"], { timeoutMs: 30_000 }).catch(() => undefined);
  }

  if (!dryRun) {
    for (const root of roots) {
      await sweepOrphanForks(root).catch(() => []);
      await sweepUnusedBases(root).catch(() => []);
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

// A removal deletes a whole tree (node_modules included), so a backlog of a
// hundred eligible worktrees must not all go in one pass on a busy box. Five
// per 15-minute pass still clears 480 a day.
export function worktreeSweepMaxRemovals(): number {
  const raw = process.env.LFG_WORKTREE_SWEEP_MAX_REMOVALS;
  const n = raw ? parseInt(raw, 10) : 5;
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

// How long a worktree must sit idle before it is eligible. Three days, from a
// dry run on 2026-10-23 (392 directories, 31 GB, disk 81% full): at seven days
// the sweep could remove 17 worktrees holding 456 KB, because sessions here
// turn over in a day or two and a week-old worktree is rare. At three days it
// could remove 154 holding 5.2 GB. The window no longer guards work, the clean
// and landed checks do, so it only decides how long a finished worktree stays
// warm for a resume. Past it, resume falls back to the project checkout
// (resolveResumeCwd in serve.ts). LFG_WORKTREE_RETENTION_MS overrides it.
export function worktreeRetentionMs(): number {
  const raw = process.env.LFG_WORKTREE_RETENTION_MS;
  const fallback = 3 * 24 * 60 * 60_000;
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
        const capturedChanges = Object.entries(r.captures)
          .filter(([, c]) => c.hadChanges)
          .map(([name]) => name);
        onLog(
          `[worktree-sweep] scanned=${r.scanned} removed=${r.removed.length}` +
            (r.removed.length ? ` [${r.removed.join(", ")}]` : "") +
            (capturedChanges.length ? ` captured-uncommitted=[${capturedChanges.join(", ")}]` : "") +
            (r.failed.length ? ` failed=[${r.failed.join(", ")}]` : "") +
            (r.captureFailed.length
              ? ` capture-failed=[${r.captureFailed.join(", ")}] (kept, needs a human look)`
              : "") +
            (r.deferred.length ? ` deferred=${r.deferred.length}` : "") +
            ` kept-dirty=${r.dirty.length} kept-unmerged=${r.unmerged.length}` +
            ` within-retention=${r.recentlyActive.length}`,
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
    `[worktree-sweep] started (every ${Math.round(intervalMs / 60_000)}m, min-age ${Math.round(worktreeSweepMinAgeMs() / 1000)}s, retention ${Math.round(worktreeRetentionMs() / 86_400_000)}d, max ${worktreeSweepMaxRemovals()} removals per pass)`,
  );
}
