#!/usr/bin/env bun
/**
 * Dry run of the worktree sweeper (src/worktree.ts, sweepStaleWorktrees).
 *
 * It calls the sweeper itself with `dryRun: true`, so the preview is the same
 * decision code the 15-minute timer runs, not a copy that can drift. In a dry
 * run the sweeper never captures, removes, prunes, or deletes a branch, and
 * every git call it makes is read-only (`status` runs with
 * --no-optional-locks, and the landed check avoids merge-tree because it
 * writes objects).
 *
 * The one write is the resume cache: opening it creates the SQLite file and
 * schema when they are missing. To read a live install without touching it,
 * point LFG_DATA_DIR at a copy of its data directory.
 *
 * Disk is measured with ONE `du` over every removable path together. Bun
 * hardlinks node_modules from its global cache, so a per-worktree `du`
 * counts the same inode once per worktree and a sum of them overstates.
 *
 * Usage:
 *   bun run scripts/worktree-reclaim-report.ts [--json] [--retention-days N] [--list-kept]
 */
import { execFileSync } from "node:child_process";
import { WORKTREE_ROOT } from "../src/config.ts";
import {
  sweepStaleWorktrees,
  worktreeRetentionMs,
  worktreeSweepMaxRemovals,
} from "../src/worktree.ts";

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function duTotal(paths: string[]): string {
  if (paths.length === 0) return "0";
  try {
    const out = execFileSync("du", ["-shc", ...paths], { encoding: "utf8", maxBuffer: 16 << 20 });
    const total = out.trim().split("\n").at(-1) ?? "";
    return total.split("\t")[0] ?? "?";
  } catch {
    return "? (du failed)";
  }
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const listKept = args.includes("--list-kept");
  const days = argValue(args, "--retention-days");
  const retentionMs = days !== undefined ? parseFloat(days) * 86_400_000 : worktreeRetentionMs();
  if (!Number.isFinite(retentionMs) || retentionMs < 0) throw new Error("--retention-days needs a number");

  const sweep = await sweepStaleWorktrees({ dryRun: true, retentionMs });
  if (asJson) {
    console.log(JSON.stringify(sweep, null, 2));
    return;
  }

  const byReason = new Map<string, string[]>();
  for (const d of sweep.decisions) {
    const list = byReason.get(d.reason) ?? [];
    list.push(d.name);
    byReason.set(d.reason, list);
  }
  const removable = sweep.decisions.filter((d) => d.action === "remove");

  console.log("DRY RUN. Nothing was captured, removed, pruned, or deleted.");
  console.log(`Worktree root: ${WORKTREE_ROOT}`);
  console.log(`Retention: ${(retentionMs / 86_400_000).toFixed(1)} days. Limit: ${worktreeSweepMaxRemovals()} removals per pass.`);
  console.log(`Scanned: ${sweep.scanned}`);
  console.log("");
  console.log("Decisions by reason:");
  for (const [reason, names] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${reason.padEnd(18)} ${String(names.length).padStart(4)}`);
  }
  console.log("");
  console.log(`Removable now: ${removable.length}. Disk they hold together (one du): ${duTotal(removable.map((d) => d.path))}`);
  for (const d of removable) {
    const idle = d.lastActivityMs ? `${((Date.now() - d.lastActivityMs) / 86_400_000).toFixed(1)}d idle` : "";
    console.log(`  ${d.name.padEnd(36)} ${idle.padStart(10)}  ${d.repoRoot ?? "?"}`);
  }
  if (listKept) {
    console.log("");
    for (const [reason, names] of byReason) {
      if (reason === "removable") continue;
      console.log(`${reason}: ${names.join(", ")}`);
    }
  }
}

await main();
