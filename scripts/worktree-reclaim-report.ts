#!/usr/bin/env bun
/**
 * Read-only report on what the worktree sweeper (src/worktree.ts,
 * sweepStaleWorktrees) would do right now under the 2026-08-23 capture-then-
 * reclaim policy. This script captures nothing, deletes nothing, and starts
 * nothing — it duplicates the sweeper's read side, on purpose, rather than
 * importing captureWorktreeSnapshot/removeSessionWorktree: a reporting tool
 * that shares code with the deletion path is one refactor away from becoming
 * a deletion tool by accident.
 *
 * Why this exists: the box hit load 44 / 24% iowait from three worktrees
 * building at once, and Storage reports "517 MB held by 4 closed sessions"
 * with dev servers that outlive session close. Before any real reclaim runs,
 * Benny needs real numbers, not a guess — and after an incident where an
 * in-process test accidentally ran the real sweep against ~/lfg-worktrees
 * (2026-08-23, 18 worktrees captured-and-removed for real, all recoverable
 * via their refs/wip/<name> commits), this script is deliberately the ONLY
 * thing that touches real data outside the sweeper's own 15-minute timer and
 * an explicit, human-approved reclaim run.
 *
 * Usage: bun run scripts/worktree-reclaim-report.ts [--json] [--retention-hours N]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { WORKTREE_ROOT } from "../src/config.ts";
import { listManaged } from "../src/managed.ts";
import { lastActivityAtForCwd } from "../src/resume-cache.ts";
import { tmuxHasSession } from "../src/tmux.ts";

const OWNED_DIR = `${WORKTREE_ROOT}/.lfg-owned`;
const DEFAULT_RETENTION_HOURS = 7 * 24; // matches worktreeRetentionMs() in src/worktree.ts

type Row = {
  name: string;
  ageHours: number;
  ageSource: "resume-cache" | "directory-mtime";
  category:
    | "blocked-live-process"
    | "within-retention"
    | "reclaimable-now"
    | "unregistered";
  dirty: boolean;
  totalBytes: number;
  nodeModulesBytes: number;
  dataDirBytes: number;
  buildOutputBytes: number;
  repoRoot: string | null;
  restoreHint: string | null;
};

function du(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    const out = execFileSync("du", ["-sb", path], { encoding: "utf8" });
    return parseInt(out.split("\t")[0] ?? "0", 10) || 0;
  } catch {
    return 0; // permission error or race with a deletion; undercount, never overcount
  }
}

function isDirty(wtPath: string): boolean {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: wtPath,
      encoding: "utf8",
      timeout: 10_000,
    });
    return out.trim().length > 0;
  } catch {
    return true; // fail closed, same rule the sweeper's capture path uses
  }
}

function repoCommonDir(wtPath: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: wtPath,
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
    // A relative path (the common case for a worktree) is relative to wtPath.
    return execFileSync("realpath", [out], { cwd: wtPath, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function repoRootFromCommonDir(commonDir: string): string {
  // commonDir looks like /path/to/repo/.git — the repo root is its parent.
  return commonDir.replace(/\/\.git\/?$/, "");
}

/** Same /proc scan sweepStaleWorktrees uses (worktree.ts, worktreesInUse),
 * reimplemented here read-only so this script never imports the deletion
 * path. Directory names a live process is currently sitting in. */
function worktreesInUse(): Set<string> {
  const inUse = new Set<string>();
  const prefix = `${WORKTREE_ROOT}/`;
  let pids: string[];
  try {
    pids = readdirSync("/proc");
  } catch {
    return inUse;
  }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    let cwd: string;
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      continue;
    }
    if (!cwd.startsWith(prefix)) continue;
    const name = cwd.slice(prefix.length).split("/")[0];
    if (name) inUse.add(name);
  }
  return inUse;
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const retentionIdx = args.indexOf("--retention-hours");
  const retentionHours =
    retentionIdx >= 0 && args[retentionIdx + 1]
      ? parseFloat(args[retentionIdx + 1]!)
      : DEFAULT_RETENTION_HOURS;
  const retentionMs = retentionHours * 3_600_000;

  if (!existsSync(WORKTREE_ROOT)) {
    console.log(`No worktree root at ${WORKTREE_ROOT}. Nothing to report.`);
    return;
  }

  const managedNames = new Set<string>();
  for (const m of listManaged()) {
    managedNames.add(m.tmuxName);
    managedNames.add(m.cwd.split("/").pop() ?? "");
  }
  const inUse = worktreesInUse();
  const now = Date.now();

  const names = readdirSync(WORKTREE_ROOT).filter((n) => !n.startsWith("."));
  const rows: Row[] = [];

  for (const name of names) {
    const wtPath = `${WORKTREE_ROOT}/${name}`;
    let st;
    try {
      st = statSync(wtPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const owned = existsSync(`${OWNED_DIR}/${name}`);
    const totalBytes = du(wtPath);
    const nodeModulesBytes = du(`${wtPath}/node_modules`);
    const dataDirBytes = du(`${wtPath}/data`);
    const buildOutputBytes =
      du(`${wtPath}/web/dist`) + du(`${wtPath}/web/dist-lib`) + du(`${wtPath}/packages`);
    const commonDir = repoCommonDir(wtPath);
    const repoRoot = commonDir ? repoRootFromCommonDir(commonDir) : null;

    if (!owned) {
      // Per Benny (2026-08-23): report separately rather than folding into
      // "unmanaged". These have no session and git registration is whatever
      // it is — never the sweeper's to touch, capture-then-reclaim policy or
      // not — but one may still be dirty and hold real work, so size + dirty
      // state are worth a human's five seconds.
      rows.push({
        name,
        ageHours: (now - st.mtimeMs) / 3_600_000,
        ageSource: "directory-mtime",
        category: "unregistered",
        dirty: isDirty(wtPath),
        totalBytes,
        nodeModulesBytes,
        dataDirBytes,
        buildOutputBytes,
        repoRoot,
        restoreHint: null,
      });
      continue;
    }

    const live = tmuxHasSession(name) || managedNames.has(name) || inUse.has(name);
    let category: Row["category"];
    let ageHours: number;
    let ageSource: Row["ageSource"];

    if (live) {
      category = "blocked-live-process";
      ageHours = 0;
      ageSource = "directory-mtime";
    } else {
      const cached = lastActivityAtForCwd(wtPath);
      const referenceMs = cached ?? st.mtimeMs;
      ageSource = cached !== null ? "resume-cache" : "directory-mtime";
      ageHours = (now - referenceMs) / 3_600_000;
      category = now - referenceMs < retentionMs ? "within-retention" : "reclaimable-now";
    }

    rows.push({
      name,
      ageHours,
      ageSource,
      category,
      dirty: category === "reclaimable-now" ? isDirty(wtPath) : false,
      totalBytes,
      nodeModulesBytes,
      dataDirBytes,
      buildOutputBytes,
      repoRoot,
      restoreHint:
        category === "reclaimable-now" && repoRoot
          ? `git -C ${repoRoot} worktree add <path> refs/wip/${name}  (created only once actually reclaimed)`
          : null,
    });
  }

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const byCategory = new Map<string, { count: number; bytes: number }>();
  for (const r of rows) {
    const e = byCategory.get(r.category) ?? { count: 0, bytes: 0 };
    e.count++;
    e.bytes += r.totalBytes;
    byCategory.set(r.category, e);
  }

  console.log(`DRY RUN. This report captures nothing, deletes nothing, and starts nothing.`);
  console.log(`Worktree root: ${WORKTREE_ROOT}`);
  console.log(`Total directories scanned: ${rows.length}`);
  console.log(`Retention window used: ${retentionHours} hours (${(retentionHours / 24).toFixed(1)} days).`);
  console.log("");
  console.log("Summary by category:");
  for (const [cat, e] of [...byCategory.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`  ${cat.padEnd(24)} count=${String(e.count).padEnd(4)} bytes=${fmtBytes(e.bytes)}`);
  }
  console.log("");

  const reclaimable = rows.filter((r) => r.category === "reclaimable-now");
  const reclaimableBytes = reclaimable.reduce((s, r) => s + r.totalBytes, 0);
  console.log(`Reclaimable now: ${reclaimable.length} worktrees, ${fmtBytes(reclaimableBytes)}.`);
  if (reclaimable.length) {
    console.log("Every one of these is captured to refs/wip/<name> BEFORE removal, dirty or clean.");
    console.log("Restore any of them after a real reclaim with:");
    console.log("  git -C <repoRoot> worktree add <path> refs/wip/<name>");
    console.log("");
    console.log("name                      age        dirty  size      repo");
    for (const r of reclaimable.sort((a, b) => b.totalBytes - a.totalBytes)) {
      console.log(
        `  ${r.name.padEnd(22)}  ${r.ageHours.toFixed(0).padStart(4)}h (${r.ageSource.padEnd(13)}) ` +
          `${(r.dirty ? "dirty" : "clean").padEnd(6)} ${fmtBytes(r.totalBytes).padStart(9)}  ${r.repoRoot ?? "?"}`,
      );
    }
  }
  console.log("");

  const liveBlocked = rows.filter((r) => r.category === "blocked-live-process");
  if (liveBlocked.length) {
    console.log(
      `Blocked by a live process (tmux, managed registry, or /proc cwd): ${liveBlocked.length} worktrees.`,
    );
  }
  const withinRetention = rows.filter((r) => r.category === "within-retention");
  if (withinRetention.length) {
    console.log(`Within the retention window, not yet eligible: ${withinRetention.length} worktrees.`);
  }
  console.log("");

  const unregistered = rows.filter((r) => r.category === "unregistered");
  if (unregistered.length) {
    const unregisteredBytes = unregistered.reduce((s, r) => s + r.totalBytes, 0);
    const dirtyUnregistered = unregistered.filter((r) => r.dirty);
    console.log(
      `Unregistered directories (no ownership marker — never the sweeper's to touch): ` +
        `${unregistered.length}, ${fmtBytes(unregisteredBytes)}.`,
    );
    console.log(
      "These are not a sweeper category at all: hand-made worktrees, release checkouts, full",
    );
    console.log(
      `clones, or pre-marker leftovers someone parked in ${WORKTREE_ROOT}. ` +
        `${dirtyUnregistered.length} of them are git-dirty and may hold real, uncommitted work:`,
    );
    for (const r of unregistered.sort((a, b) => b.totalBytes - a.totalBytes)) {
      console.log(
        `  ${r.name.padEnd(28)} ${(r.dirty ? "dirty" : "clean").padEnd(6)} ${fmtBytes(r.totalBytes).padStart(9)}  ${r.repoRoot ?? "(not a registered git worktree of any repo)"}`,
      );
    }
    console.log("These need a human look before anything is decided about them, one at a time.");
  }
  console.log("");

  const totalNodeModules = rows.reduce((s, r) => s + r.nodeModulesBytes, 0);
  const totalData = rows.reduce((s, r) => s + r.dataDirBytes, 0);
  const totalBuildOutput = rows.reduce((s, r) => s + r.buildOutputBytes, 0);
  console.log("Composition across all scanned directories:");
  console.log(`  node_modules (apparent, pre-hardlink-dedup): ${fmtBytes(totalNodeModules)}`);
  console.log(`  data/ (gitignored runtime state: sqlite caches, logs): ${fmtBytes(totalData)}`);
  console.log(`  build output (web/dist, dist-lib, packages/*/dist): ${fmtBytes(totalBuildOutput)}`);
  console.log("");
  console.log(
    "Cost to rebuild a reclaimed worktree: one bun install plus a typecheck. " +
      "The web/tsconfig.json source-path change and scripts/test-builds.ts mean a " +
      "typecheck no longer needs a full package build first.",
  );
}

main();
