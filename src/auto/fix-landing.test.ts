// The #185 worked example end to end: a finding whose dispatched fix landed
// on origin/main, and reconcileFixLandings is the piece that used to not
// exist — nothing ever checked, so the finding sat "open" (really "session")
// for two months after commit 66732e8 had already fixed it.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";

const originalData = PATHS.data;
let testRoot = "";
let store: typeof import("./store.ts");
let managed: typeof import("../managed.ts");
let fixLanding: typeof import("./fix-landing.ts");

beforeAll(async () => {
  testRoot = mkdtempSync(join(tmpdir(), "lfg-fix-landing-store-"));
  PATHS.data = join(testRoot, "data");
  store = await import("./store.ts");
  managed = await import("../managed.ts");
  fixLanding = await import("./fix-landing.ts");
});

afterEach(() => {
  managed.resetManagedRegistryForTests();
  rmSync(join(PATHS.data, "auto"), { recursive: true, force: true });
});

afterAll(() => {
  PATHS.data = originalData;
  rmSync(testRoot, { recursive: true, force: true });
});

const react185Title =
  "Frontend error: Minified React error #185; visit https://react.dev/errors/185 for the full message";

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const r = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: r.stdout.toString().trim() };
}

/** A fix session's worktree whose commit was pushed straight to origin/main — same shape land-session.sh leaves behind. */
function landedFixWorktree(dirs: string[]): { work: string; branch: string } {
  const origin = mkdtempSync(join(tmpdir(), "fix-landing-origin-"));
  const work = mkdtempSync(join(tmpdir(), "fix-landing-work-"));
  dirs.push(origin, work);
  git(origin, ["init", "--quiet", "--bare", "-b", "main"]);
  git(work, ["clone", "--quiet", origin, "."]);
  git(work, ["config", "user.email", "t@example.com"]);
  git(work, ["config", "user.name", "T"]);
  writeFileSync(join(work, "seed.txt"), "seed\n");
  git(work, ["add", "."]);
  git(work, ["commit", "--quiet", "-m", "seed"]);
  git(work, ["push", "--quiet", "origin", "main"]);

  const branch = "fix_clienterr_abc123";
  git(work, ["checkout", "--quiet", "-b", branch, "origin/main"]);
  writeFileSync(join(work, "voice-tts.ts"), "// stabilize snapshot\n");
  git(work, ["add", "."]);
  git(work, ["commit", "--quiet", "-m", "fix(web): stabilize useSpeechPlayback snapshot"]);
  git(work, ["push", "--quiet", "origin", `${branch}:main`]);
  return { work, branch };
}

/** A fix session's worktree that has committed but not yet pushed anywhere. */
function unlandedFixWorktree(dirs: string[]): { work: string; branch: string } {
  const origin = mkdtempSync(join(tmpdir(), "fix-landing-unlanded-origin-"));
  const work = mkdtempSync(join(tmpdir(), "fix-landing-unlanded-work-"));
  dirs.push(origin, work);
  git(origin, ["init", "--quiet", "--bare", "-b", "main"]);
  git(work, ["clone", "--quiet", origin, "."]);
  git(work, ["config", "user.email", "t@example.com"]);
  git(work, ["config", "user.name", "T"]);
  writeFileSync(join(work, "seed.txt"), "seed\n");
  git(work, ["add", "."]);
  git(work, ["commit", "--quiet", "-m", "seed"]);
  git(work, ["push", "--quiet", "origin", "main"]);

  const branch = "fix_clienterr_stillworking";
  git(work, ["checkout", "--quiet", "-b", branch, "origin/main"]);
  writeFileSync(join(work, "voice-tts.ts"), "// wip\n");
  git(work, ["add", "."]);
  git(work, ["commit", "--quiet", "-m", "wip"]); // never pushed
  return { work, branch };
}

describe("reconcileFixLandings — the #185 worked example", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test("a finding whose fix session's commit reached origin/main becomes fix-landed with the commit recorded", async () => {
    const finding = await store.addFinding({
      agentId: "client-error",
      title: react185Title,
      reasoning: ["Kind: react", "Component: useSpeechPlayback"],
      severity: "high",
    });
    await store.attachFixSession(finding.id, "sess-185");

    const { work, branch } = landedFixWorktree(dirs);
    managed.addManaged({
      tmuxName: branch,
      cwd: work,
      createdAt: 0,
      agent: "aisdk",
      sessionId: "sess-185",
      repoRoot: work,
      worktreeBranch: branch,
    });

    const result = await fixLanding.reconcileFixLandings(1_000);
    expect(result.landed.map((f) => f.id)).toContain(finding.id);
    expect(result.resolved).toHaveLength(0); // landed just now — still inside the grace window

    const row = (await store.listFindings("fix-landed")).find((r) => r.id === finding.id);
    expect(row).toBeDefined();
    expect(row?.fixCommit).toMatch(/^[0-9a-f]{7,}$/);
    expect(row?.fixLandedAt).toBe(1_000);
  });

  test("never recurring for the grace window is what promotes it all the way to resolved", async () => {
    const finding = await store.addFinding({
      agentId: "client-error",
      title: react185Title,
      reasoning: ["Kind: react"],
      severity: "high",
    });
    await store.attachFixSession(finding.id, "sess-185b");
    const { work, branch } = landedFixWorktree(dirs);
    managed.addManaged({
      tmuxName: branch,
      cwd: work,
      createdAt: 0,
      agent: "aisdk",
      sessionId: "sess-185b",
      repoRoot: work,
      worktreeBranch: branch,
    });

    await fixLanding.reconcileFixLandings(1_000);
    // Two months of silence, like the real #185 case — nothing ever reported
    // the error again, so the second reconcile pass (the escalation check)
    // finally calls it resolved.
    const twoMonthsLater = 1_000 + 60 * 24 * 60 * 60_000;
    const result = await fixLanding.reconcileFixLandings(twoMonthsLater);
    expect(result.resolved.map((f) => f.id)).toContain(finding.id);
    const row = (await store.listFindings("resolved")).find((r) => r.id === finding.id);
    expect(row?.status).toBe("resolved");
  });

  test("a dispatched session that hasn't pushed anywhere yet is left alone — a session existing is not landing", async () => {
    const finding = await store.addFinding({
      agentId: "client-error",
      title: "Frontend error: something else entirely",
      reasoning: ["Kind: error"],
      severity: "high",
    });
    await store.attachFixSession(finding.id, "sess-wip");
    const { work, branch } = unlandedFixWorktree(dirs);
    managed.addManaged({
      tmuxName: branch,
      cwd: work,
      createdAt: 0,
      agent: "aisdk",
      sessionId: "sess-wip",
      repoRoot: work,
      worktreeBranch: branch,
    });

    const result = await fixLanding.reconcileFixLandings(1_000);
    expect(result.landed).toHaveLength(0);
    const row = (await store.listFindings()).find((r) => r.id === finding.id);
    expect(row?.status).toBe("session");
  });

  test("a session already reaped from the managed registry is left as-is — no evidence, no claim", async () => {
    const finding = await store.addFinding({
      agentId: "client-error",
      title: "Frontend error: reaped session case",
      reasoning: ["Kind: error"],
      severity: "high",
    });
    await store.attachFixSession(finding.id, "sess-gone");
    // No managed.addManaged call — simulates the worktree/registry entry
    // already having been cleaned up by the time reconcile runs.

    const result = await fixLanding.reconcileFixLandings(1_000);
    expect(result.landed).toHaveLength(0);
    const row = (await store.listFindings()).find((r) => r.id === finding.id);
    expect(row?.status).toBe("session");
  });
});
