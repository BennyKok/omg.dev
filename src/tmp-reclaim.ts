// Agents and bunx default to os.tmpdir(). On this fleet /tmp is tmpfs, so a
// leftover checkout or bun install is a RAM allocation. One incident filled
// 7.8G, put the box in memory reclaim (load ~30, PSI ~97%), and made every
// process look like it was "eating CPU".
//
// One owner: this module. It picks a disk-backed temp dir, applies it to the
// serve process and every agent launch, and sweeps unused leftovers in tmpfs
// /tmp plus our own cache dir. It never deletes a path a live process still
// holds, and it never touches systemd/tmux/ssh/X11 names.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statfsSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const TMPFS_MAGIC = 0x01021994;
export const RAMFS_MAGIC = 0x858458f6;

const DEFAULT_TMP_SWEEP_MS = 30 * 60_000;
const DEFAULT_TMPFS_MIN_AGE_MS = 2 * 60 * 60_000;
const DEFAULT_CACHE_MIN_AGE_MS = 24 * 60 * 60_000;

const PROTECTED_PREFIXES = [
  ".",
  "ssh-",
  "systemd-private",
  "snap-private",
  "tmux-",
  "vscode-",
  "pulse-",
  "claude-",
  "cursor-agent-logs-",
] as const;

const PROTECTED_NAMES = new Set(["lfg-uploads"]);

export function isRamBackedFs(type: number | bigint): boolean {
  const n = Number(type);
  return n === TMPFS_MAGIC || n === RAMFS_MAGIC;
}

export function isPathRamBacked(path: string): boolean {
  try {
    return isRamBackedFs(statfsSync(path).type);
  } catch {
    return false;
  }
}

export function defaultDiskTmpDir(home = homedir()): string {
  return join(home, ".cache", "lfg", "tmp");
}

export function resolveAgentTmpDir(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const override = env.LFG_TMPDIR?.trim();
  if (override) return override;
  return defaultDiskTmpDir(home);
}

/** Disk temp dir when /tmp (or the current TMPDIR) is RAM-backed, else null. */
export function diskTmpDirIfNeeded(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string | null {
  if (env.LFG_TMPDIR?.trim()) return env.LFG_TMPDIR.trim();
  const current = env.TMPDIR?.trim() || tmpdir();
  if (isPathRamBacked(current) || isPathRamBacked("/tmp")) {
    return defaultDiskTmpDir(home);
  }
  return null;
}

export function agentTmpEnv(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): Record<string, string> {
  const dir = diskTmpDirIfNeeded(env, home);
  if (!dir) return {};
  return { TMPDIR: dir, TMP: dir, TEMP: dir };
}

export function ensureDiskBackedTmpdir(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string | null {
  const dir = diskTmpDirIfNeeded(env, home);
  if (!dir) return null;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  env.TMPDIR = dir;
  env.TMP = dir;
  env.TEMP = dir;
  return dir;
}

export function isProtectedTmpName(name: string): boolean {
  if (PROTECTED_NAMES.has(name)) return true;
  return PROTECTED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function shouldSweepTmpEntry(input: {
  name: string;
  ageMs: number;
  minAgeMs: number;
  open: boolean;
  uidOwned: boolean;
}): boolean {
  if (!input.uidOwned) return false;
  if (input.open) return false;
  if (input.ageMs < input.minAgeMs) return false;
  if (isProtectedTmpName(input.name)) return false;
  return true;
}

export function pathIsOpen(path: string, openPaths: Iterable<string>): boolean {
  const target = resolve(path);
  for (const raw of openPaths) {
    const open = resolve(raw);
    if (open === target || open.startsWith(`${target}/`)) return true;
  }
  return false;
}

/** Live cwd / fd / exe paths under `root`. Linux only; empty elsewhere. */
export function collectOpenPathsUnder(root: string): Set<string> {
  const hits = new Set<string>();
  if (process.platform !== "linux") return hits;
  const prefix = resolve(root);
  const want = (dest: string) => {
    if (!dest.startsWith("/") || dest.includes("(deleted)")) return;
    const abs = resolve(dest);
    if (abs === prefix || abs.startsWith(`${prefix}/`)) hits.add(abs);
  };
  let pids: string[];
  try {
    pids = readdirSync("/proc");
  } catch {
    return hits;
  }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    for (const rel of ["cwd", "exe"] as const) {
      try {
        want(readlinkSync(`/proc/${pid}/${rel}`));
      } catch {}
    }
    try {
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        try {
          want(readlinkSync(`/proc/${pid}/fd/${fd}`));
        } catch {}
      }
    } catch {}
  }
  return hits;
}

export type TmpSweepResult = {
  scanned: number;
  removed: string[];
  failed: string[];
};

export function sweepTmpRoot(
  root: string,
  opts: {
    now?: number;
    minAgeMs?: number;
    uid?: number;
    openPaths?: Iterable<string>;
    protectNames?: boolean;
  } = {},
): TmpSweepResult {
  const result: TmpSweepResult = { scanned: 0, removed: [], failed: [] };
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return result;
  }
  const now = opts.now ?? Date.now();
  const minAgeMs = opts.minAgeMs ?? DEFAULT_TMPFS_MIN_AGE_MS;
  const uid = opts.uid ?? (typeof process.getuid === "function" ? process.getuid() : -1);
  const openPaths = opts.openPaths ?? collectOpenPathsUnder(root);
  const protectNames = opts.protectNames ?? true;

  for (const name of names) {
    const path = join(root, name);
    result.scanned += 1;
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(path);
    } catch {
      continue;
    }
    const ageMs = Math.max(0, now - st.mtimeMs);
    const uidOwned = uid < 0 || st.uid === uid;
    const open = pathIsOpen(path, openPaths);
    const protectedName = protectNames && isProtectedTmpName(name);
    if (!uidOwned || open || ageMs < minAgeMs || protectedName) continue;
    try {
      rmSync(path, { recursive: true, force: true });
      if (!existsSync(path)) result.removed.push(name);
    } catch {
      result.failed.push(name);
    }
  }
  return result;
}

export function sweepStaleTmp(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): { tmpfs: TmpSweepResult | null; cache: TmpSweepResult | null } {
  const tmpfs = isPathRamBacked("/tmp")
    ? sweepTmpRoot("/tmp", { minAgeMs: tmpfsMinAgeMs(env) })
    : null;
  const cache = resolveAgentTmpDir(env, home);
  const cacheSweep =
    cache !== "/tmp" && existsSync(cache)
      ? sweepTmpRoot(cache, {
          minAgeMs: cacheMinAgeMs(env),
          protectNames: false,
        })
      : null;
  return { tmpfs, cache: cacheSweep };
}

function tmpfsMinAgeMs(env: NodeJS.ProcessEnv): number {
  return readMs(env.LFG_TMP_SWEEP_MIN_AGE_MS, DEFAULT_TMPFS_MIN_AGE_MS);
}

function cacheMinAgeMs(env: NodeJS.ProcessEnv): number {
  return readMs(env.LFG_TMP_CACHE_MIN_AGE_MS, DEFAULT_CACHE_MIN_AGE_MS);
}

function sweepIntervalMs(env: NodeJS.ProcessEnv): number {
  if (env.LFG_TMP_SWEEP_MS === "0") return 0;
  return readMs(env.LFG_TMP_SWEEP_MS, DEFAULT_TMP_SWEEP_MS);
}

function readMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let sweeping = false;

export function startTmpSweep(onLog: (s: string) => void = () => {}): void {
  if (process.platform !== "linux") return;
  const intervalMs = sweepIntervalMs(process.env);
  if (intervalMs === 0) return;
  if (sweepTimer) return;

  const run = () => {
    if (sweeping) return;
    sweeping = true;
    try {
      const { tmpfs, cache } = sweepStaleTmp();
      const removed = (tmpfs?.removed.length ?? 0) + (cache?.removed.length ?? 0);
      const failed = (tmpfs?.failed.length ?? 0) + (cache?.failed.length ?? 0);
      if (removed || failed) {
        onLog(
          `[tmp-sweep] tmpfs_removed=${tmpfs?.removed.length ?? 0}` +
            ` cache_removed=${cache?.removed.length ?? 0}` +
            (failed ? ` failed=${failed}` : ""),
        );
      }
    } catch (e) {
      onLog(`[tmp-sweep] error: ${e}`);
    } finally {
      sweeping = false;
    }
  };

  sweepTimer = setInterval(run, intervalMs);
  const startupDelayMs = Math.min(intervalMs, 5 * 60_000);
  setTimeout(run, startupDelayMs);
  onLog(
    `[tmp-sweep] started (every ${Math.round(intervalMs / 60_000)}m, ` +
      `tmpfs min-age ${Math.round(tmpfsMinAgeMs(process.env) / 3600_000)}h)`,
  );
}

export function stopTmpSweepForTests(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  sweeping = false;
}
