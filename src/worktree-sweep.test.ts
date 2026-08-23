// The worktree sweeper deletes directories, so every guard it has is a guard
// against destroying work. These tests pin the one that was missing.
//
// After a reboot, the sweeper deleted the worktrees of thirteen sessions that
// were alive and mid-task. Each one looked dead to every check the sweeper had:
// the tmux pane was gone (the reboot killed it), the managed row had been
// replaced by a resume under a new runtime name, and no process was sitting in
// the directory yet. All three signals describe *this instant*, so a session
// that a crash knocked over reads as garbage — and deleting its worktree is
// precisely what turns a recoverable session into an unrecoverable one.
//
// Runs the sweeper in a subprocess pinned to a throwaway LFG_WORKTREE_ROOT.
// WORKTREE_ROOT is a top-level `const` in config.ts, resolved once from
// process.env at import time — reassigning it from a test is not possible,
// and importing this module in-process without the env var set means every
// call operates on the developer's REAL ~/lfg-worktrees. That used to be
// harmless only because the old permanent "never delete anything dirty" rule
// protected every real worktree from an in-process test run by accident. The
// 2026-08-23 capture-then-reclaim policy removed that rule — dirty worktrees
// are captured and reclaimed like any other once their retention window
// passes — so an in-process run of this file actually captured and removed
// 18 real worktrees across four repos the first time it ran under the new
// policy. Nothing was lost (the capture commits were all recoverable via
// their refs/wip/<name>), but it should never have been possible. Subprocess
// isolation, like the other two sweep test files already use, is the fix.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");

type SweepResult = {
  scanned: number;
  removed: string[];
  kept: number;
  skippedYoung: number;
  failed: string[];
  unmanaged: string[];
  dirty: string[];
  recentlyActive: string[];
  captureFailed: string[];
  captures: Record<string, { ref: string; commit: string; hadChanges: boolean }>;
};

/**
 * Runs one sweep against a fresh, isolated worktree root: a single owned,
 * clean worktree plus one resume-cache row recording when its session was
 * last active, then reports whether the sweeper removed it and whether the
 * branch cleanup that follows a real removal ran.
 */
function runProbe(
  lastActivityAgoMs: number,
): { sweep: SweepResult; branchGone: boolean; name: string } {
  const root = mkdtempSync(join(tmpdir(), "lfg-sweep-"));
  const scriptPath = join(root, "probe.mjs");
  const worktreeRoot = join(root, "worktrees");
  const originPath = join(root, "repo");
  const dataPath = join(root, "data");
  writeFileSync(
    scriptPath,
    `
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.LFG_WORKTREE_ROOT;
mkdirSync(root, { recursive: true });

const run = (cwd, ...args) => {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr.toString());
};

const origin = process.env.PROBE_ORIGIN;
mkdirSync(origin, { recursive: true });
run(origin, "init", "-q", "-b", "main");
run(origin, "config", "user.email", "test@example.com");
run(origin, "config", "user.name", "test");
writeFileSync(join(origin, "file.txt"), "committed\\n");
run(origin, "add", "-A");
run(origin, "commit", "-qm", "init");

const name = process.env.PROBE_NAME;
const path = join(root, name);
run(origin, "worktree", "add", "-q", "-b", "session_" + name, path, "main");

// The ownership marker is what makes a directory sweepable at all.
mkdirSync(join(root, ".lfg-owned"), { recursive: true });
writeFileSync(join(root, ".lfg-owned", name), Date.now() + "\\n");

const { PATHS } = await import(${JSON.stringify(join(REPO, "src/config.ts"))});
PATHS.data = process.env.PROBE_DATA;
mkdirSync(PATHS.data, { recursive: true });

const { upsertResumableRows } = await import(${JSON.stringify(join(REPO, "src/resume-cache.ts"))});
const now = Date.now();
upsertResumableRows([{
  sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  cwd: path,
  project: "test",
  title: "probe session",
  lastActivityAt: now - Number(process.env.PROBE_LAST_ACTIVITY_AGO_MS),
  lastUserText: "probe",
  agent: "claude",
  path: null,
  mtimeMs: now,
}]);

const { sweepStaleWorktrees } = await import(${JSON.stringify(join(REPO, "src/worktree.ts"))});
const sweep = await sweepStaleWorktrees({ minAgeMs: 0, now, retentionMs: 24 * 60 * 60_000 });

const branchCheck = Bun.spawnSync(["git", "-C", origin, "show-ref", "--verify", "refs/heads/session_" + name]);

console.log(JSON.stringify({ sweep, branchGone: branchCheck.exitCode !== 0 }));
`,
  );
  const name = `lfg-sweep-probe-${Math.random().toString(16).slice(2, 10)}`;
  try {
    const r = Bun.spawnSync(["bun", scriptPath], {
      env: {
        ...process.env,
        LFG_WORKTREE_ROOT: worktreeRoot,
        PROBE_ORIGIN: originPath,
        PROBE_NAME: name,
        PROBE_DATA: dataPath,
        PROBE_LAST_ACTIVITY_AGO_MS: String(lastActivityAgoMs),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = r.stdout.toString().trim();
    expect(r.exitCode, `probe failed: ${r.stderr.toString()}`).toBe(0);
    const line = out.split("\n").at(-1) ?? "";
    expect(line, `probe stdout: ${out}\nstderr: ${r.stderr.toString()}`).toStartWith("{");
    const parsed = JSON.parse(line);
    return { sweep: parsed.sweep, branchGone: parsed.branchGone, name };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("worktree sweeper", () => {
  test("keeps the worktree of a session that was active recently", () => {
    const { sweep, name } = runProbe(60_000); // 1 minute ago
    expect(sweep.removed).not.toContain(name);
    expect(sweep.recentlyActive).toContain(name);
  });

  test("still reclaims a worktree once its session has gone quiet", () => {
    const { sweep, branchGone, name } = runProbe(5 * 24 * 60 * 60_000); // 5 days ago
    expect(sweep.recentlyActive).not.toContain(name);
    expect(sweep.removed).toContain(name);
    // Clean worktree still gets captured, uniformly, even with nothing to lose.
    expect(sweep.captures[name]).toBeTruthy();
    expect(sweep.captures[name].hadChanges).toBe(false);
    expect(branchGone).toBe(true);
  });
});
