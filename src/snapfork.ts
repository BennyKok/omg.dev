// Snapshot forks: an opt-in alternative to a full `git worktree add` checkout.
//
// A session worktree is normally a complete checkout plus its own dependency
// install. A snapshot fork keeps every git behaviour of that worktree (its own
// `session_<name>` branch, index and HEAD under the repository's
// `.git/worktrees/<name>`), but its files come from a shared, read-only base
// checkout through fuse-overlayfs. Writes land in a private upper layer.
//
//   <WORKTREE_ROOT>/.snapfork/bases/<repo-key>/<sha>   detached checkout + deps, never modified
//   <WORKTREE_ROOT>/.snapfork/layers/<name>/upper       the session's own changes
//   <WORKTREE_ROOT>/<name>                              the mount; agents work here as before
//
// A base can sit some commits behind the session's starting commit. After the
// mount, a two-tree `read-tree -m -u` moves the working tree from the base
// commit to the session commit, and only the changed files are written to the
// upper layer. One base can therefore serve every session for a day.
//
// Invariants:
//   - A base is never modified after it is marked ready. fuse-overlayfs caches
//     lower-layer sizes, so an in-place change shows a mounted fork a corrupted
//     file (seen in the 2026-10-28 prototype: NUL-padded source files).
//   - Every failure falls back to a normal checkout. Snapshot forks can make a
//     session cheaper; they must never make a create fail.
//   - The `.snapfork` directory starts with a dot, so the worktree sweeper
//     skips it as bookkeeping.
//
// Enable with LFG_SNAPFORK=1. LFG_FUSE_OVERLAYFS overrides the binary path.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { WORKTREE_ROOT } from "./config.ts";

type RunResult = { ok: boolean; out: string; err: string };

async function run(
  cmd: string[],
  opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string | undefined> },
): Promise<RunResult> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn({
      cmd,
      cwd: opts?.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      ...(opts?.env ? { env: { ...process.env, ...opts.env } } : {}),
    });
  } catch (e) {
    return { ok: false, out: "", err: e instanceof Error ? e.message : String(e) };
  }
  const timer = opts?.timeoutMs ? setTimeout(() => proc.kill(), opts.timeoutMs) : null;
  try {
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    return { ok: code === 0, out, err };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const git = (cwd: string, args: string[], timeoutMs = 60_000) =>
  run(["git", "-C", cwd, ...args], { timeoutMs });

function which(bin: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const p = join(dir, bin);
    if (existsSync(p)) return p;
  }
  return null;
}

export function overlayBinary(): string | null {
  const explicit = process.env.LFG_FUSE_OVERLAYFS;
  if (explicit) return existsSync(explicit) ? explicit : null;
  return which("fuse-overlayfs");
}

function fusermountBinary(): string | null {
  return which("fusermount3") ?? which("fusermount");
}

export function snapforkEnabled(): boolean {
  if (process.env.LFG_SNAPFORK !== "1") return false;
  return !!overlayBinary() && !!fusermountBinary() && existsSync("/dev/fuse");
}

const BASE_MAX_AGE_MS = (() => {
  const n = parseInt(process.env.LFG_SNAPFORK_BASE_MAX_AGE_MS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 24 * 60 * 60_000;
})();
const BASE_MAX_BEHIND = (() => {
  const n = parseInt(process.env.LFG_SNAPFORK_BASE_MAX_BEHIND ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 300;
})();

export function snapforkRoot(root: string = WORKTREE_ROOT): string {
  return `${root}/.snapfork`;
}

function layerDir(name: string, root: string): string {
  return `${snapforkRoot(root)}/layers/${name}`;
}

function repoKey(repo: string): string {
  let real = resolve(repo);
  try {
    real = realpathSync(real);
  } catch {}
  return `${basename(real)}-${createHash("sha1").update(real).digest("hex").slice(0, 8)}`;
}

function basesDir(repo: string, root: string): string {
  return `${snapforkRoot(root)}/bases/${repoKey(repo)}`;
}

type LayerMeta = { base: string; baseSha: string; repo: string };

function readMeta(name: string, root: string): LayerMeta | null {
  try {
    return JSON.parse(readFileSync(`${layerDir(name, root)}/meta.json`, "utf8")) as LayerMeta;
  } catch {
    return null;
  }
}

/** Whether `<root>/<name>` was provisioned as a snapshot fork. */
export function isSnapfork(name: string, root: string = WORKTREE_ROOT): boolean {
  return readMeta(name, root) !== null;
}

function unescapeMountPath(s: string): string {
  return s.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));
}

export function isMounted(path: string): boolean {
  const target = resolve(path);
  try {
    for (const line of readFileSync("/proc/self/mountinfo", "utf8").split("\n")) {
      const mountPoint = line.split(" ")[4];
      if (mountPoint && unescapeMountPath(mountPoint) === target) return true;
    }
  } catch {}
  return false;
}

async function mountLayer(name: string, root: string, meta: LayerMeta): Promise<RunResult> {
  const bin = overlayBinary();
  if (!bin) return { ok: false, out: "", err: "fuse-overlayfs not found" };
  const dir = layerDir(name, root);
  const mnt = `${root}/${name}`;
  mkdirSync(`${dir}/upper`, { recursive: true });
  mkdirSync(`${dir}/work`, { recursive: true });
  mkdirSync(mnt, { recursive: true });
  if (isMounted(mnt)) return { ok: true, out: "", err: "" };
  // fuse-overlayfs forks into the background and chdirs to "/", so the
  // sweeper's /proc/<pid>/cwd scan never mistakes the daemon for a user.
  const mountCmd = [bin, "-o", `lowerdir=${meta.base},upperdir=${dir}/upper,workdir=${dir}/work`, mnt];
  // Give the daemon its own systemd scope. Started from serve it would sit in
  // lfg.service's cgroup, where a memory kill could pick it and leave every
  // process in the fork with "Transport endpoint is not connected".
  const systemdRun = process.platform === "linux" && process.env.LFG_SNAPFORK_SCOPE !== "0"
    ? which("systemd-run")
    : null;
  if (systemdRun) {
    const scoped = await run(
      [systemdRun, "--user", "--scope", "--quiet", "--collect", `--unit=lfg-snapfork-${name}-${Date.now()}`, "--slice=lfg.slice", ...mountCmd],
      { cwd: "/", timeoutMs: 30_000 },
    );
    if (scoped.ok || isMounted(mnt)) return scoped.ok ? scoped : { ok: true, out: "", err: "" };
  }
  return run(mountCmd, { cwd: "/", timeoutMs: 30_000 });
}

/** Mount a fork whose daemon is gone (after a reboot). No-op when mounted. */
export async function ensureSnapforkMounted(
  name: string,
  root: string = WORKTREE_ROOT,
): Promise<boolean> {
  const meta = readMeta(name, root);
  if (!meta) return false;
  const mnt = `${root}/${name}`;
  if (isMounted(mnt)) {
    try {
      statSync(mnt);
      return true;
    } catch {
      // The daemon died and left a dead mount (ENOTCONN). Detach it, then
      // mount again over the same upper layer; no work is lost.
      const fm = fusermountBinary();
      if (fm) await run([fm, "-uz", mnt], { timeoutMs: 30_000 });
      if (isMounted(mnt)) return false;
    }
  }
  if (!existsSync(meta.base)) return false;
  return (await mountLayer(name, root, meta)).ok;
}

/** Mount the fork that contains `path`, if any. For resume paths. */
export async function ensureSnapforkMountedForPath(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const abs = resolve(path);
  const prefix = `${WORKTREE_ROOT}/`;
  if (!abs.startsWith(prefix)) return;
  const name = abs.slice(prefix.length).split("/")[0];
  if (name && !name.startsWith(".")) await ensureSnapforkMounted(name, WORKTREE_ROOT);
}

/** Mount every fork under the root. Called once at server start. */
export async function remountSnapforks(
  root: string = WORKTREE_ROOT,
  log: (s: string) => void = () => {},
): Promise<void> {
  const layers = `${snapforkRoot(root)}/layers`;
  if (!existsSync(layers)) return;
  let mounted = 0;
  for (const name of readdirSync(layers)) {
    if (!isMounted(`${root}/${name}`) && (await ensureSnapforkMounted(name, root))) mounted++;
  }
  if (mounted) log(`[snapfork] remounted ${mounted} fork(s)`);
}

// ---------------------------------------------------------------------------
// Bases

type ReadyBase = { path: string; sha: string; readyAt: number };

function readyBases(repo: string, root: string): ReadyBase[] {
  const dir = basesDir(repo, root);
  if (!existsSync(dir)) return [];
  const out: ReadyBase[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".ready")) continue;
    const sha = entry.slice(0, -".ready".length);
    const path = `${dir}/${sha}`;
    if (!existsSync(path)) continue;
    try {
      out.push({ path, sha, readyAt: statSync(`${dir}/${entry}`).mtimeMs });
    } catch {}
  }
  return out.sort((a, b) => b.readyAt - a.readyAt);
}

async function findReusableBase(
  repo: string,
  targetSha: string,
  root: string,
  now = Date.now(),
): Promise<ReadyBase | null> {
  for (const base of readyBases(repo, root)) {
    if (now - base.readyAt > BASE_MAX_AGE_MS) continue;
    if (base.sha === targetSha) return base;
    if (!(await git(repo, ["merge-base", "--is-ancestor", base.sha, targetSha])).ok) continue;
    const behind = await git(repo, ["rev-list", "--count", `${base.sha}..${targetSha}`]);
    if (behind.ok && parseInt(behind.out.trim(), 10) <= BASE_MAX_BEHIND) return base;
  }
  return null;
}

const building = new Map<string, Promise<ReadyBase | null>>();

/**
 * Build a base checkout at `sha`: a detached worktree plus a frozen dependency
 * install. The `.ready` marker is written last, so a half-built base is never
 * used. Concurrent requests for the same repository share one build.
 */
export function buildBase(
  repo: string,
  sha: string,
  root: string = WORKTREE_ROOT,
): Promise<ReadyBase | null> {
  const key = basesDir(repo, root);
  const inflight = building.get(key);
  if (inflight) return inflight;
  const job = (async (): Promise<ReadyBase | null> => {
    const dir = basesDir(repo, root);
    const path = `${dir}/${sha}`;
    mkdirSync(dir, { recursive: true });
    if (existsSync(`${path}.ready`) && existsSync(path)) {
      return { path, sha, readyAt: statSync(`${path}.ready`).mtimeMs };
    }
    if (existsSync(path)) {
      await git(repo, ["worktree", "remove", "--force", path]);
      rmSync(path, { recursive: true, force: true });
    }
    const add = await git(repo, ["worktree", "add", "--detach", path, sha], 300_000);
    if (!add.ok) return null;
    if (existsSync(`${path}/bun.lock`) && process.env.LFG_SNAPFORK_INSTALL !== "0") {
      // Installed OUTSIDE any overlay, so bun hardlinks from its global cache.
      // Inside a fork the same install would copy, because a hardlink cannot
      // cross into the FUSE mount (EXDEV).
      const install = await run(["nice", "-n", "10", "bun", "install", "--frozen-lockfile"], {
        cwd: path,
        timeoutMs: 10 * 60_000,
      });
      if (!install.ok) {
        await git(repo, ["worktree", "remove", "--force", path]);
        rmSync(path, { recursive: true, force: true });
        return null;
      }
    }
    writeFileSync(`${path}.ready`, `${new Date().toISOString()}\n`);
    return { path, sha, readyAt: Date.now() };
  })().finally(() => building.delete(key));
  building.set(key, job);
  return job;
}

// ---------------------------------------------------------------------------
// Fork lifecycle

export type SnapforkCreate =
  /** The worktree is a mounted snapshot fork. */
  | { kind: "snapfork"; baseSha: string }
  /** No usable base yet. One is building; the caller makes a normal worktree. */
  | { kind: "no-base" }
  /** Snapshot setup failed after git registered the worktree; it was checked out normally. */
  | { kind: "plain"; reason: string }
  | { kind: "error"; error: string };

/**
 * Register `session_<name>` as a worktree without a checkout, mount the
 * newest usable base under it, and move the files to the session commit.
 */
export async function createSnapfork(opts: {
  repo: string;
  name: string;
  branch: string;
  ref: string;
  wtPath: string;
  root?: string;
}): Promise<SnapforkCreate> {
  const root = opts.root ?? WORKTREE_ROOT;
  const { repo, name, branch, wtPath } = opts;
  const target = await git(repo, ["rev-parse", "--verify", `${opts.ref}^{commit}`]);
  if (!target.ok) return { kind: "error", error: target.err.trim() || "cannot resolve base ref" };
  const targetSha = target.out.trim();

  const base = await findReusableBase(repo, targetSha, root);
  if (!base) {
    void buildBase(repo, targetSha, root).catch(() => null);
    return { kind: "no-base" };
  }

  let add = await git(repo, ["worktree", "add", "--no-checkout", "-b", branch, wtPath, targetSha]);
  if (!add.ok) add = await git(repo, ["worktree", "add", "--no-checkout", wtPath, branch]);
  if (!add.ok) return { kind: "error", error: add.err.trim() || "git worktree add failed" };

  const fallback = async (reason: string): Promise<SnapforkCreate> => {
    await removeSnapforkLayer(name, root, { keepMountpoint: true }).catch(() => undefined);
    // The worktree is registered with an empty index. A hard reset fills the
    // index and the directory exactly as `git worktree add` would have.
    if (existsSync(join(wtPath, ".git"))) {
      const reset = await git(wtPath, ["reset", "-q", "--hard", "HEAD"], 300_000);
      if (reset.ok) return { kind: "plain", reason };
    }
    return { kind: "error", error: `snapfork failed (${reason}) and the checkout fallback failed` };
  };

  const dir = layerDir(name, root);
  try {
    mkdirSync(`${dir}/upper`, { recursive: true });
    // The session's own `.git` pointer must win over the base's, or every
    // fork would share the base's index and HEAD.
    copyFileSync(join(wtPath, ".git"), `${dir}/upper/.git`);
    const meta: LayerMeta = { base: base.path, baseSha: base.sha, repo: resolve(repo) };
    writeFileSync(`${dir}/meta.json`, `${JSON.stringify(meta)}\n`);
    const mount = await mountLayer(name, root, meta);
    if (!mount.ok) return fallback(`mount: ${mount.err.trim()}`);
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  }

  // Seed the session index from the base's. Files seen through the mount
  // report the base's own inode, size, mtime and ctime, so the base's stat
  // data is valid in the fork and git never has to re-read a file. Without
  // this, a refresh hashed every file through FUSE: 7.2 s of a 7.7 s create on
  // a 270 MB repository. The seeded index must describe exactly the base
  // tree; anything else falls back to the slow, always-correct path.
  const seeded = await seedIndexFromBase(base.path, base.sha, wtPath);
  const steps: string[][] = seeded
    ? [
        ["read-tree", "-m", "-u", base.sha, "HEAD"],
        ["update-index", "-q", "--refresh"],
      ]
    : [
        ["read-tree", base.sha],
        // read-tree leaves no stat data, so refresh before the two-tree merge
        // or it refuses every file as "not uptodate".
        ["update-index", "-q", "--refresh"],
        ["read-tree", "-m", "-u", base.sha, "HEAD"],
        ["update-index", "-q", "--refresh"],
      ];
  for (const args of steps) {
    const r = await git(wtPath, args, 300_000);
    // update-index --refresh exits 1 when files differ, which is fine here;
    // the read-tree steps are the ones that must succeed.
    if (!r.ok && args[0] === "read-tree") return fallback(`${args.join(" ")}: ${r.err.trim()}`);
  }
  // The base's node_modules match the base's lockfile. When the session
  // commit changed it, install the difference now so the fork never runs on
  // stale dependencies. Only changed packages land in the upper layer.
  if (
    existsSync(join(wtPath, "bun.lock")) &&
    process.env.LFG_SNAPFORK_INSTALL !== "0" &&
    !(await git(wtPath, ["diff", "--quiet", base.sha, "HEAD", "--", "bun.lock", "package.json"])).ok
  ) {
    const install = await run(["nice", "-n", "10", "bun", "install", "--frozen-lockfile"], {
      cwd: wtPath,
      timeoutMs: 10 * 60_000,
    });
    if (!install.ok) return fallback(`bun install: ${install.err.trim().slice(-300)}`);
  }
  return { kind: "snapfork", baseSha: base.sha };
}

async function seedIndexFromBase(basePath: string, baseSha: string, wtPath: string): Promise<boolean> {
  const [baseIndex, sessionIndex, baseTree] = await Promise.all([
    git(basePath, ["rev-parse", "--path-format=absolute", "--git-path", "index"]),
    git(wtPath, ["rev-parse", "--path-format=absolute", "--git-path", "index"]),
    git(basePath, ["rev-parse", `${baseSha}^{tree}`]),
  ]);
  if (!baseIndex.ok || !sessionIndex.ok || !baseTree.ok) return false;
  // Refresh the base's own index first. It runs on the real filesystem, so it
  // is cheap, and it clears "racily clean" entries written in the same second
  // as their files, which git would otherwise re-hash in every fork. It
  // changes only the index in the base's git directory, never a base file.
  await git(basePath, ["update-index", "-q", "--refresh"]);
  try {
    copyFileSync(baseIndex.out.trim(), sessionIndex.out.trim());
  } catch {
    return false;
  }
  const tree = await git(wtPath, ["write-tree"]);
  if (tree.ok && tree.out.trim() === baseTree.out.trim()) return true;
  rmSync(sessionIndex.out.trim(), { force: true });
  return false;
}

/**
 * Unmount a fork and delete its upper layer. The caller has already captured
 * the work (removeSessionWorktree). The empty mountpoint is removed too, so
 * `git worktree prune` can drop the registration.
 */
export async function removeSnapforkLayer(
  name: string,
  root: string = WORKTREE_ROOT,
  opts?: { keepMountpoint?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const mnt = `${root}/${name}`;
  if (isMounted(mnt)) {
    const fm = fusermountBinary();
    if (!fm) return { ok: false, error: "fusermount not found" };
    const u = await run([fm, "-u", mnt], { timeoutMs: 30_000 });
    if (!u.ok) return { ok: false, error: u.err.trim() || "unmount failed (busy?)" };
  }
  rmSync(layerDir(name, root), { recursive: true, force: true });
  if (opts?.keepMountpoint) return { ok: true };
  // Under the mount sits only the `.git` pointer that `worktree add
  // --no-checkout` wrote. Anything else means files landed there outside the
  // mount; leave the directory for a human rather than delete them.
  try {
    if (existsSync(mnt) && readdirSync(mnt).every((e) => e === ".git")) {
      rmSync(mnt, { recursive: true, force: true });
    }
  } catch {}
  return { ok: true };
}

/**
 * Remove bases no fork uses. The newest ready base of each repository stays,
 * so the next session can start from it.
 */
export async function sweepUnusedBases(
  root: string = WORKTREE_ROOT,
  opts?: { minAgeMs?: number; now?: number },
): Promise<string[]> {
  const now = opts?.now ?? Date.now();
  const minAgeMs = opts?.minAgeMs ?? 60 * 60_000;
  const basesRoot = `${snapforkRoot(root)}/bases`;
  if (!existsSync(basesRoot)) return [];
  const used = new Set<string>();
  const layers = `${snapforkRoot(root)}/layers`;
  if (existsSync(layers)) {
    for (const name of readdirSync(layers)) {
      const m = readMeta(name, root);
      if (m) used.add(resolve(m.base));
    }
  }
  const removed: string[] = [];
  for (const key of readdirSync(basesRoot)) {
    const dir = `${basesRoot}/${key}`;
    if (building.has(dir)) continue;
    const entries = readdirSync(dir).filter((e) => !e.endsWith(".ready"));
    const readyTimes = new Map<string, number>();
    for (const e of readdirSync(dir).filter((e) => e.endsWith(".ready"))) {
      try {
        readyTimes.set(e.slice(0, -".ready".length), statSync(`${dir}/${e}`).mtimeMs);
      } catch {}
    }
    const newest = [...readyTimes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    for (const sha of entries) {
      const path = `${dir}/${sha}`;
      if (sha === newest || used.has(resolve(path))) continue;
      const age = now - (readyTimes.get(sha) ?? statSync(path).mtimeMs);
      if (age < minAgeMs) continue;
      const repo = await git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      if (repo.ok) {
        await git(resolve(repo.out.trim(), ".."), ["worktree", "remove", "--force", path], 300_000);
      }
      rmSync(path, { recursive: true, force: true });
      rmSync(`${path}.ready`, { force: true });
      if (repo.ok) await git(resolve(repo.out.trim(), ".."), ["worktree", "prune"]);
      removed.push(path);
    }
  }
  return removed;
}
