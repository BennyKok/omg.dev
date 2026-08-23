#!/usr/bin/env bun
/**
 * Read-only report on what sweepStaleWorktrees (src/worktree.ts) would find if
 * every safety gate were evaluated right now, plus disk sizes it does not
 * compute today. This script deletes nothing and starts nothing.
 *
 * Why this exists: the box hit load 44 / 24% iowait tonight from three
 * worktrees building at once, and Storage reports "517 MB held by 4 closed
 * sessions" with dev servers that outlive session close. Before any reaper
 * change ships, we need real numbers: how many of the 80+ worktrees under
 * WORKTREE_ROOT are actually dead, how much disk each holds, and why the
 * existing 15-minute sweep (src/worktree.ts:369 sweepStaleWorktrees) is not
 * already reclaiming them. Guessing that would risk either under-selling the
 * problem or, worse, becoming the argument for a destructive change nobody
 * reviewed.
 *
 * This duplicates (does not import) the sweeper's liveness checks:
 * sweepStaleWorktrees's own functions are private and, more importantly,
 * end in a real `git worktree remove --force`. A reporting tool that shares
 * code with a deletion tool is one refactor away from becoming a deletion
 * tool by accident. Keep them apart on purpose.
 *
 * Usage: bun run scripts/worktree-reclaim-report.ts [--json] [--min-age-hours N]
 */
import { existsSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { WORKTREE_ROOT } from "../src/config.ts";
import { listManaged } from "../src/managed.ts";
import { recentlyActiveCwds } from "../src/resume-cache.ts";
import { tmuxHasSession } from "../src/tmux.ts";

const OWNED_DIR = `${WORKTREE_ROOT}/.lfg-owned`;
const DEFAULT_MIN_AGE_HOURS = 48; // matches the brief: "not touched in over 2 days"
const RECENT_ACTIVITY_MS = 24 * 60 * 60_000; // same window sweepStaleWorktrees uses

type Row = {
  name: string;
  ageHours: number;
  owned: boolean;
  dirty: boolean;
  liveProcess: boolean;
  tmux: boolean;
  managed: boolean;
  recentlyActive: boolean;
  totalBytes: number;
  nodeModulesBytes: number;
  dataDirBytes: number;
  buildOutputBytes: number;
  category: string;
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
    const out = execFileSync("git", ["-C", wtPath, "status", "--porcelain"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return out.trim().length > 0;
  } catch {
    return true; // fail closed, same rule sweepStaleWorktrees uses
  }
}

/** Worktree directory names a live process is currently sitting in. Same
 * /proc scan sweepStaleWorktrees uses (worktree.ts:341), reimplemented here
 * read-only so this script has no import into the deletion path. */
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

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const minAgeIdx = args.indexOf("--min-age-hours");
  const minAgeHours =
    minAgeIdx >= 0 && args[minAgeIdx + 1] ? parseFloat(args[minAgeIdx + 1]!) : DEFAULT_MIN_AGE_HOURS;

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
  const recentNames = new Set<string>();
  for (const cwd of recentlyActiveCwds(RECENT_ACTIVITY_MS, now)) {
    if (cwd.startsWith(`${WORKTREE_ROOT}/`)) {
      recentNames.add(cwd.slice(WORKTREE_ROOT.length + 1).split("/")[0]!);
    }
  }

  const names = readdirSync(WORKTREE_ROOT).filter(n => !n.startsWith("."));
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
    const tmux = tmuxHasSession(name);
    const managed = managedNames.has(name);
    const live = inUse.has(name);
    const recent = recentNames.has(name);
    const ageHours = (now - st.mtimeMs) / 3_600_000;
    const dirty = isDirty(wtPath);

    const totalBytes = du(wtPath);
    const nodeModulesBytes = du(`${wtPath}/node_modules`);
    const dataDirBytes = du(`${wtPath}/data`);
    const buildOutputBytes =
      du(`${wtPath}/web/dist`) + du(`${wtPath}/web/dist-lib`) + du(`${wtPath}/packages`);

    let category: string;
    if (!owned) category = "unmanaged"; // never auto-deletable regardless of age
    else if (tmux || managed || live) category = "blocked-live-process";
    else if (recent) category = "blocked-recently-active";
    else if (ageHours < minAgeHours) category = "young";
    else if (dirty) category = "blocked-uncommitted-work";
    else category = "reclaimable-now";

    rows.push({
      name,
      ageHours,
      owned,
      dirty,
      liveProcess: live,
      tmux,
      managed,
      recentlyActive: recent,
      totalBytes,
      nodeModulesBytes,
      dataDirBytes,
      buildOutputBytes,
      category,
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

  console.log(`DRY RUN. This report deletes nothing and stops nothing.`);
  console.log(`Worktree root: ${WORKTREE_ROOT}`);
  console.log(`Total worktrees scanned: ${rows.length}`);
  console.log(`Stale threshold used: ${minAgeHours} hours.`);
  console.log("");
  console.log("Summary by category:");
  for (const [cat, e] of [...byCategory.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`  ${cat.padEnd(28)} count=${String(e.count).padEnd(4)} bytes=${fmtBytes(e.bytes)}`);
  }
  console.log("");

  const reclaimable = rows.filter(r => r.category === "reclaimable-now");
  const reclaimableBytes = reclaimable.reduce((s, r) => s + r.totalBytes, 0);
  console.log(
    `Reclaimable now: ${reclaimable.length} worktrees, ${fmtBytes(reclaimableBytes)}.`,
  );
  if (reclaimable.length) {
    console.log("Reclaimable worktree list (name, age in hours, total size):");
    for (const r of reclaimable.sort((a, b) => b.totalBytes - a.totalBytes)) {
      console.log(`  ${r.name.padEnd(24)} age=${r.ageHours.toFixed(0)}h  size=${fmtBytes(r.totalBytes)}`);
    }
  }
  console.log("");

  const dirtyBlocked = rows.filter(r => r.category === "blocked-uncommitted-work");
  if (dirtyBlocked.length) {
    const dirtyBytes = dirtyBlocked.reduce((s, r) => s + r.totalBytes, 0);
    console.log(
      `Blocked by uncommitted work: ${dirtyBlocked.length} worktrees, ${fmtBytes(dirtyBytes)}.`,
    );
    console.log("These are old and idle by every liveness signal, but git status is not clean.");
    console.log("Deleting them would delete work that exists nowhere else. Human judgment needed.");
  }
  console.log("");

  const liveBlocked = rows.filter(r => r.category === "blocked-live-process");
  if (liveBlocked.length) {
    console.log(
      `Blocked by a live process (tmux, managed registry, or /proc cwd): ${liveBlocked.length} worktrees.`,
    );
  }

  const totalNodeModules = rows.reduce((s, r) => s + r.nodeModulesBytes, 0);
  const totalData = rows.reduce((s, r) => s + r.dataDirBytes, 0);
  const totalBuildOutput = rows.reduce((s, r) => s + r.buildOutputBytes, 0);
  console.log("");
  console.log("Composition across all scanned worktrees (not just reclaimable ones):");
  console.log(`  node_modules (apparent, pre-hardlink-dedup): ${fmtBytes(totalNodeModules)}`);
  console.log(`  data/ (gitignored runtime state: sqlite caches, logs): ${fmtBytes(totalData)}`);
  console.log(`  build output (web/dist, dist-lib, packages/*/dist): ${fmtBytes(totalBuildOutput)}`);
  console.log("");
  console.log(
    "Cost to rebuild a reclaimed worktree: one bun install plus a typecheck. " +
      "The web/tsconfig.json source-path change and scripts/test-builds.ts landed tonight, " +
      "so a typecheck no longer needs a full package build first.",
  );
}

main();
