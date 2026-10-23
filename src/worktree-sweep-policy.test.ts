// What the worktree sweeper may remove (2026-10-23 policy): only a worktree
// with nothing to lose. Owned, not live, idle past retention, clean, and
// landed on upstream main, where "landed" has to cover squash and rebase
// landings, not just ancestry.
//
// The fixture repo has no user identity and the probe runs with an empty
// global git config. That is the shape that kept 19 real worktrees in
// capture-failed forever: commit-tree refused with "Author identity unknown".
//
// Runs in a subprocess pinned to a throwaway LFG_WORKTREE_ROOT and
// LFG_DATA_DIR. Importing worktree.ts in-process would sweep the developer's
// real worktrees (see worktree-sweep.test.ts for the 2026-08-23 incident).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");

type Decision = { name: string; action: "remove" | "keep"; reason: string };
type Sweep = {
  removed: string[];
  removable: string[];
  deferred: string[];
  captureFailed: string[];
  failed: string[];
  captures: Record<string, { ref: string; hadChanges: boolean }>;
  decisions: Decision[];
};
type Probe = {
  dry: Sweep;
  dryLeftEverything: boolean;
  dryWipRefs: string;
  capped: Sweep;
  rest: Sweep;
  exists: Record<string, boolean>;
  branches: string;
  worktreeList: string;
  wipRefs: string;
};

const PROBE = `
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.LFG_WORKTREE_ROOT;
const base = process.env.PROBE_BASE;
mkdirSync(root, { recursive: true });

const ID = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com"];
const run = (cwd, ...args) => {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr.toString());
  return r.stdout.toString();
};
const commit = (cwd, msg) => { run(cwd, "add", "-A"); run(cwd, ...ID, "commit", "-qm", msg); };

// upstream.git is the remote; repo/ is the project checkout with origin/main.
const upstream = join(base, "upstream.git");
const repo = join(base, "repo");
run(base, "init", "-q", "--bare", "-b", "main", upstream);
run(base, "clone", "-q", upstream, repo);
run(repo, "checkout", "-q", "-b", "main");
writeFileSync(join(repo, "README.md"), "hi\\n");
writeFileSync(join(repo, ".gitignore"), "node_modules/\\n");
commit(repo, "init");
run(repo, "push", "-q", "origin", "main");

const owned = (name) => {
  mkdirSync(join(root, ".lfg-owned"), { recursive: true });
  writeFileSync(join(root, ".lfg-owned", name), "0\\n");
};
const add = (name, branch = "session_" + name, mark = true) => {
  const path = join(root, name);
  run(repo, "worktree", "add", "-q", "-b", branch, path, "main");
  if (mark) owned(name);
  return path;
};

// Landed in four different ways.
add("wt-fresh");
const ignored = add("wt-ignored");
mkdirSync(join(ignored, "node_modules"), { recursive: true });
writeFileSync(join(ignored, "node_modules", "dep.js"), "1\\n");
add("lfg-nomarker", "session_lfg-nomarker", false);

const squash = add("wt-squash");
writeFileSync(join(squash, "a.txt"), "1\\n"); commit(squash, "a1");
writeFileSync(join(squash, "a.txt"), "1\\n2\\n"); commit(squash, "a2");
writeFileSync(join(repo, "a.txt"), "1\\n2\\n"); commit(repo, "squash of wt-squash");

const rebase = add("wt-rebase");
writeFileSync(join(rebase, "r.txt"), "one\\n"); commit(rebase, "r1");
run(repo, ...ID, "cherry-pick", "session_wt-rebase");
writeFileSync(join(repo, "r.txt"), "one\\ntwo\\n"); commit(repo, "main edits r.txt again");
writeFileSync(join(repo, "c.txt"), "later\\n"); commit(repo, "unrelated later work");
run(repo, "push", "-q", "origin", "main");

// Kept, each for one reason.
const unmerged = add("wt-unmerged");
writeFileSync(join(unmerged, "u.txt"), "unlanded\\n"); commit(unmerged, "never landed");
const dirty = add("wt-dirty");
writeFileSync(join(dirty, "notes.txt"), "never added\\n");
add("handmade", "feature-by-hand", false);
add("wt-recent-index");
add("wt-managed");
add("wt-locked");
run(repo, "worktree", "lock", join(root, "wt-locked"));
run(base, "clone", "-q", upstream, join(root, "full-clone"));
owned("full-clone");

// Everything has been idle for ten days, except wt-recent-index's git index.
const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
for (const name of ["wt-fresh", "wt-ignored", "lfg-nomarker", "wt-squash", "wt-rebase",
  "wt-unmerged", "wt-dirty", "handmade", "wt-recent-index", "wt-managed", "wt-locked", "full-clone"]) {
  const path = join(root, name);
  const gitdir = run(path, "rev-parse", "--absolute-git-dir").trim();
  for (const p of [join(gitdir, "index"), join(gitdir, "HEAD"), join(gitdir, "logs", "HEAD"), path]) {
    try { utimesSync(p, tenDaysAgo, tenDaysAgo); } catch {}
  }
}
const recentGitdir = run(join(root, "wt-recent-index"), "rev-parse", "--absolute-git-dir").trim();
utimesSync(join(recentGitdir, "index"), new Date(), new Date());

// A launching row: no process yet, no tmux pane, still not removable.
mkdirSync(process.env.LFG_DATA_DIR, { recursive: true });
writeFileSync(join(process.env.LFG_DATA_DIR, "managed-sessions.json"), JSON.stringify({
  version: 2,
  creationClaims: {},
  sessions: { "wt-managed": {
    tmuxName: "wt-managed", cwd: join(root, "wt-managed"), createdAt: Date.now(),
    agent: "claude", launchState: "launching",
  } },
}));

const { sweepStaleWorktrees } = await import(${JSON.stringify(join(REPO, "src/worktree.ts"))});
const opts = { minAgeMs: 0 };

const names = ["wt-fresh", "wt-ignored", "lfg-nomarker", "wt-squash", "wt-rebase",
  "wt-unmerged", "wt-dirty", "handmade", "wt-recent-index", "wt-managed", "wt-locked", "full-clone"];
const dry = await sweepStaleWorktrees({ ...opts, dryRun: true });
const dryLeftEverything = names.every((n) => existsSync(join(root, n)));
const dryWipRefs = run(repo, "for-each-ref", "refs/wip/");
const capped = await sweepStaleWorktrees({ ...opts, maxRemovals: 2 });
const rest = await sweepStaleWorktrees({ ...opts, maxRemovals: 10 });

console.log(JSON.stringify({
  dry, dryLeftEverything, dryWipRefs, capped, rest,
  exists: Object.fromEntries(names.map((n) => [n, existsSync(join(root, n))])),
  branches: run(repo, "branch", "--list", "--format=%(refname:short)"),
  worktreeList: run(repo, "worktree", "list", "--porcelain"),
  wipRefs: run(repo, "for-each-ref", "--format=%(refname)", "refs/wip/"),
}));
`;

function runProbe(): Probe {
  const base = mkdtempSync(join(tmpdir(), "lfg-sweep-policy-"));
  const scriptPath = join(base, "probe.mjs");
  const emptyGitConfig = join(base, "empty.gitconfig");
  writeFileSync(scriptPath, PROBE);
  writeFileSync(emptyGitConfig, "");
  const env: Record<string, string | undefined> = {
    ...process.env,
    LFG_WORKTREE_ROOT: join(base, "worktrees"),
    LFG_DATA_DIR: join(base, "data"),
    LFG_WORKTREE_LEGACY_ROOTS: "",
    PROBE_BASE: base,
    // No identity anywhere, like the repos that failed capture for real.
    GIT_CONFIG_GLOBAL: emptyGitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const key of ["EMAIL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) {
    delete env[key];
  }
  try {
    const r = Bun.spawnSync(["bun", scriptPath], { env, stdout: "pipe", stderr: "pipe" });
    const out = r.stdout.toString().trim();
    expect(r.exitCode, `probe failed: ${r.stderr.toString()}`).toBe(0);
    const line = out.split("\n").at(-1) ?? "";
    expect(line, `probe stdout: ${out}\nstderr: ${r.stderr.toString()}`).toStartWith("{");
    return JSON.parse(line);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const LANDED = ["lfg-nomarker", "wt-fresh", "wt-ignored", "wt-rebase", "wt-squash"];

function reasons(sweep: Sweep): Record<string, string> {
  return Object.fromEntries(sweep.decisions.map((d) => [d.name, d.reason]));
}

describe("worktree sweep removal policy", () => {
  const probe = runProbe();

  test("a dry run names exactly the worktrees with nothing to lose, and touches none", () => {
    expect([...probe.dry.removable].sort()).toEqual(LANDED);
    expect(probe.dry.removed).toEqual([]);
    expect(probe.dryLeftEverything).toBe(true);
    expect(probe.dryWipRefs).toBe("");
  });

  test("every kept worktree reports why", () => {
    expect(reasons(probe.dry)).toMatchObject({
      "wt-unmerged": "unmerged",
      "wt-dirty": "dirty",
      handmade: "unowned",
      "wt-recent-index": "within-retention",
      "wt-managed": "managed",
      "wt-locked": "locked",
      "full-clone": "main-checkout",
    });
  });

  test("a pass removes at most its limit and defers the rest", () => {
    expect(probe.capped.removed).toHaveLength(2);
    expect(probe.capped.deferred).toHaveLength(LANDED.length - 2);
    expect([...probe.capped.removed, ...probe.rest.removed].sort()).toEqual(LANDED);
  });

  test("capture succeeds in a repo with no git identity", () => {
    expect(probe.capped.captureFailed).toEqual([]);
    expect(probe.rest.captureFailed).toEqual([]);
    expect(probe.rest.failed).toEqual([]);
    for (const name of LANDED) expect(probe.wipRefs).toContain(`refs/wip/${name}`);
  });

  test("removal goes through git, so the repo forgets the worktrees", () => {
    for (const name of LANDED) {
      expect(probe.exists[name]).toBe(false);
      expect(probe.worktreeList).not.toContain(`/worktrees/${name}\n`);
    }
    for (const name of ["wt-unmerged", "wt-dirty", "handmade", "wt-recent-index", "wt-managed", "wt-locked", "full-clone"]) {
      expect(probe.exists[name]).toBe(true);
    }
  });

  test("a fully merged session branch is deleted; unmerged and squash branches stay", () => {
    const branches = probe.branches.split("\n").filter(Boolean);
    // deleteMergedSessionBranch only ever deletes `session_lfg-*` names.
    expect(branches).not.toContain("session_lfg-nomarker");
    expect(branches).toContain("session_wt-unmerged");
    // Squash and rebase landings leave a branch whose commits are not
    // ancestors of main. Deleting it is a separate, stricter decision.
    expect(branches).toContain("session_wt-squash");
  });
});
