// WORKTREE_ROOT is a shared directory on a developer's machine, not private
// scratch space owned by the sweeper. People park hand-made worktrees, release
// checkouts and full clones in there. Those have no tmux session, no managed
// registry row and usually no process sitting in them, which is exactly the
// shape the sweeper called "stale" — so it deleted them, repeatedly.
//
// Observed 2026-08-08 in the serve log: `vibes-frontdoor` and `vibes-lfgpin`,
// both hand-made worktrees of ~/repos/vibes, removed 22 minutes apart. The
// owner's workaround was to move their worktrees out of the directory entirely.
//
// Two rules are locked in here:
//   1. The sweeper may only delete worktrees the sweeper itself provisioned.
//   2. Uncommitted work no longer earns a worktree a permanent stay (policy,
//      2026-08-23): it earns a WIP commit under refs/wip/<name> instead, taken
//      before removal, and it is reclaimed like anything else past its
//      retention window. This file proves that snapshot actually reconstructs
//      the untracked file — a diff would have missed it entirely.
//
// All the git assertions run INSIDE the probe subprocess, before its runner
// tears the fixture down, rather than from this file afterward: the runner's
// `finally` removes the whole scratch root (origin repo included), so a
// `git -C origin ...` call from out here would just be checking a directory
// that no longer exists.
//
// Like the live-process probe next door, this runs the sweeper in a subprocess
// pinned to a throwaway LFG_WORKTREE_ROOT — importing it in-process would sweep
// the developer's REAL worktrees as a side effect.
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
  captureFailed: string[];
  captures: Record<string, { ref: string; commit: string; hadChanges: boolean }>;
};

type CaptureCheck = {
  refExists: boolean;
  untracked: string | null;
  tracked: string | null;
  restoreWorks: boolean;
};

type Probe = {
  sweep: SweepResult;
  stillExists: Record<string, boolean>;
  captureChecks: Record<string, CaptureCheck>;
};

function runProbe(): Probe {
  const root = mkdtempSync(join(tmpdir(), "lfg-sweep-own-"));
  const scriptPath = join(root, "probe.mjs");
  const worktreeRoot = join(root, "worktrees");
  const originPath = join(root, "origin");
  writeFileSync(
    scriptPath,
    `
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const root = process.env.LFG_WORKTREE_ROOT;
mkdirSync(root, { recursive: true });

const run = (cwd, ...args) =>
  Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });

// An upstream repo with one commit, so real worktrees can be added from it.
const origin = process.env.PROBE_ORIGIN;
mkdirSync(origin, { recursive: true });
run(origin, "init", "-q", "-b", "main");
run(origin, "config", "user.email", "probe@example.com");
run(origin, "config", "user.name", "probe");
writeFileSync(origin + "/README.md", "hi\\n");
run(origin, "add", "-A");
run(origin, "commit", "-qm", "init");

// 1. A hand-made worktree a human parked here. No ownership marker.
const handmade = root + "/handmade-release";
run(origin, "worktree", "add", "-q", "-b", "handmade", handmade, "main");

// 2. A worktree the sweeper provisioned, clean. Reclaimable.
const clean = root + "/lfg-clean";
run(origin, "worktree", "add", "-q", "-b", "session_clean", clean, "main");

// 3. A worktree the sweeper provisioned holding uncommitted work: one
// UNTRACKED file (never \`git add\`ed — the case a diff would have missed
// entirely) and one modification to a tracked file.
const dirty = root + "/lfg-dirty";
run(origin, "worktree", "add", "-q", "-b", "session_dirty", dirty, "main");
writeFileSync(dirty + "/unsaved-work.txt", "hours of it\\n");
writeFileSync(dirty + "/README.md", "hi, but edited\\n");

// Mark only the two the sweeper "created".
mkdirSync(root + "/.lfg-owned", { recursive: true });
writeFileSync(root + "/.lfg-owned/lfg-clean", "0\\n");
writeFileSync(root + "/.lfg-owned/lfg-dirty", "0\\n");

const { sweepStaleWorktrees } = await import(${JSON.stringify(join(REPO, "src/worktree.ts"))});
// retentionMs: 0 — this probe tests the ownership/capture guards, not the age
// policy, and a fresh git-worktree-add always has a brand new mtime.
const sweep = await sweepStaleWorktrees({ minAgeMs: 0, retentionMs: 0 });

// Check every capture's ref right here, before this whole scratch root (origin
// repo included) gets torn down by the runner that spawned this script.
function checkCapture(name, wantUntracked, wantTracked) {
  const capture = sweep.captures[name];
  if (!capture) return { refExists: false, untracked: null, tracked: null, restoreWorks: false };
  const refExists = run(origin, "rev-parse", "--verify", capture.ref).exitCode === 0;
  const untracked = run(origin, "show", capture.ref + ":unsaved-work.txt");
  const tracked = run(origin, "show", capture.ref + ":README.md");
  const restorePath = root + "/restored-" + name;
  const add = run(origin, "worktree", "add", restorePath, capture.ref);
  let restoreWorks = false;
  if (add.exitCode === 0) {
    try {
      restoreWorks =
        (wantUntracked === null || readFileSync(restorePath + "/unsaved-work.txt", "utf8") === wantUntracked) &&
        readFileSync(restorePath + "/README.md", "utf8") === wantTracked;
    } catch {
      restoreWorks = false;
    }
    run(origin, "worktree", "remove", "--force", restorePath);
  }
  return {
    refExists,
    untracked: untracked.exitCode === 0 ? untracked.stdout.toString() : null,
    tracked: tracked.exitCode === 0 ? tracked.stdout.toString() : null,
    restoreWorks,
  };
}

console.log(JSON.stringify({
  sweep,
  stillExists: {
    "handmade-release": existsSync(handmade),
    "lfg-clean": existsSync(clean),
    "lfg-dirty": existsSync(dirty),
    "dirty-file": existsSync(dirty + "/unsaved-work.txt"),
  },
  captureChecks: {
    "lfg-dirty": checkCapture("lfg-dirty", "hours of it\\n", "hi, but edited\\n"),
    "lfg-clean": checkCapture("lfg-clean", null, "hi\\n"),
  },
}));
`,
  );
  try {
    const r = Bun.spawnSync(["bun", scriptPath], {
      env: {
        ...process.env,
        LFG_WORKTREE_ROOT: worktreeRoot,
        PROBE_ORIGIN: originPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = r.stdout.toString().trim();
    expect(r.exitCode, `probe failed: ${r.stderr.toString()}`).toBe(0);
    const line = out.split("\n").at(-1) ?? "";
    expect(line, `probe stdout: ${out}\nstderr: ${r.stderr.toString()}`).toStartWith("{");
    return JSON.parse(line);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("worktree sweep ownership", () => {
  const probe = runProbe();

  test("never touches a worktree it did not provision", () => {
    const { sweep, stillExists } = probe;
    expect(sweep.removed).not.toContain("handmade-release");
    // `failed` counts too: it means the sweeper tried and git refused.
    expect(sweep.failed).not.toContain("handmade-release");
    expect(sweep.unmanaged).toContain("handmade-release");
    expect(stillExists["handmade-release"]).toBe(true);
  });

  test("captures a dirty worktree's exact contents before reclaiming it", () => {
    const { sweep, stillExists, captureChecks } = probe;
    // The worktree itself is gone — dirty no longer means "kept forever".
    expect(sweep.removed).toContain("lfg-dirty");
    expect(sweep.captureFailed).not.toContain("lfg-dirty");
    expect(stillExists["lfg-dirty"]).toBe(false);
    expect(stillExists["dirty-file"]).toBe(false);

    // A real commit survives under refs/wip/<name>, in the shared common git
    // dir (not the worktree that just disappeared) — and it is what got
    // reported for anyone restoring it.
    const capture = sweep.captures["lfg-dirty"];
    expect(capture).toBeTruthy();
    expect(capture.hadChanges).toBe(true);

    const check = captureChecks["lfg-dirty"];
    expect(check.refExists).toBe(true);
    // Not just a ref that exists, but the ACTUAL content: the untracked file
    // (never `git add`ed — exactly what a diff would miss) and the
    // tracked-file edit are both in the captured tree.
    expect(check.untracked).toBe("hours of it\n");
    expect(check.tracked).toBe("hi, but edited\n");
    // And the documented restore command (`git worktree add <path> <ref>`)
    // actually works end to end.
    expect(check.restoreWorks).toBe(true);
  });

  test("still reclaims an owned worktree with nothing left to lose", () => {
    const { sweep, stillExists, captureChecks } = probe;
    // Proves the capture above comes from the new dirty-handling rather than
    // the sweeper having stopped removing anything at all.
    expect(sweep.removed).toContain("lfg-clean");
    expect(stillExists["lfg-clean"]).toBe(false);

    // Clean gets captured too, uniformly — the ref should just mirror HEAD.
    const capture = sweep.captures["lfg-clean"];
    expect(capture).toBeTruthy();
    expect(capture.hadChanges).toBe(false);
    expect(captureChecks["lfg-clean"].refExists).toBe(true);
  });
});
