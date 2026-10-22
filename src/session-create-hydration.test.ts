// Session create answers before its worktree and agent exist, then starts them
// in the background. These pin the three things that make that safe:
//
// 1. The just-created row is listed while it has no pane or harness yet, so
//    the session the person just made does not disappear before it starts.
// 2. A background start that fails stays listed with its reason, while the
//    older recovery failures (no launchFailedAt) stay hidden as before.
// 3. Admission can count from the newest finished scan plus the records
//    created since it began, so create does not wait for a full scan.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recentAdmissionSessions } from "./agent-admission.ts";
import { PATHS } from "./config.ts";
import { resetManagedRegistryForTests, type ManagedSession } from "./managed.ts";
import { createSessionListCache } from "./session-cache.ts";
import { managedLaunchRow, type Session } from "./sessions.ts";
import { resetTranscriptIndexConnectionForTests } from "./transcript-index.ts";
import { planSessionCwd, WORKTREE_ROOT } from "./worktree.ts";

const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lfg-create-hydration-"));
  PATHS.data = join(root, "data");
  mkdirSync(PATHS.data, { recursive: true });
  resetManagedRegistryForTests();
  resetTranscriptIndexConnectionForTests();
});

afterEach(() => {
  resetManagedRegistryForTests();
  resetTranscriptIndexConnectionForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

const noPane = { hasSession: () => false, panePid: () => null, targetForPid: () => null };

function record(overrides: Partial<ManagedSession>): ManagedSession {
  return {
    tmuxName: "lfg-abc123",
    cwd: "/work/project",
    createdAt: Date.now(),
    agent: "claude",
    runtime: "tmux",
    sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    launchState: "launching",
    project: "project",
    ...overrides,
  };
}

describe("a session in its background start", () => {
  test("is listed as launching before its tmux pane exists", () => {
    const row = managedLaunchRow(record({ hydrating: true }), {}, {}, noPane);
    expect(row).not.toBeNull();
    expect(row?.launching).toBe(true);
    expect(row?.status).toBe("ok");
    expect(row?.tmuxTarget).toBe("lfg-abc123:0.0");
  });

  test("is listed before its command-file harness registers, even past the old boot window", () => {
    const row = managedLaunchRow(
      record({ agent: "aisdk", runtime: "command-file", hydrating: true, createdAt: Date.now() - 60_000 }),
      {},
      {},
      noPane,
    );
    expect(row?.launching).toBe(true);
    expect(row?.status).toBe("ok");
  });

  test("says it did not start when the server died mid-start", () => {
    const row = managedLaunchRow(
      record({ hydrating: true, createdAt: Date.now() - 10 * 60_000 }),
      {},
      {},
      noPane,
    );
    expect(row?.launching).toBe(false);
    expect(row?.status).toBe("blocked");
    expect(row?.statusReason).toBe("launch_failed");
  });

  test("a failed start stays listed with its reason, for both runtimes", () => {
    for (const runtime of ["tmux", "command-file"] as const) {
      const row = managedLaunchRow(
        record({
          runtime,
          agent: runtime === "tmux" ? "claude" : "aisdk",
          launchState: "failed",
          launchError: "git worktree add failed: disk full",
          launchFailedAt: Date.now(),
        }),
        {},
        {},
        noPane,
      );
      expect(row?.status).toBe("blocked");
      expect(row?.statusReason).toBe("launch_failed");
      expect(row?.statusDetail).toBe("git worktree add failed: disk full");
      expect(row?.launching).toBe(false);
    }
  });

  test("an older recovery failure without launchFailedAt stays hidden", () => {
    const row = managedLaunchRow(
      record({ launchState: "failed", launchError: "codex recovery handle missing" }),
      {},
      {},
      noPane,
    );
    expect(row).toBeNull();
  });

  test("a record with no pane that is not starting is still dropped", () => {
    expect(managedLaunchRow(record({ launchState: "running" }), {}, {}, noPane)).toBeNull();
  });
});

describe("recentAdmissionSessions", () => {
  const scanStartedAt = 1_000_000;
  const scan = {
    startedAt: scanStartedAt,
    sessions: [{ tmuxName: "lfg-old" }, { tmuxName: "lfg-listed" }],
  };

  test("adds the records created after the scan began, once each", () => {
    const counted = recentAdmissionSessions(
      scan,
      [
        { tmuxName: "lfg-old", createdAt: scanStartedAt - 5_000 },
        { tmuxName: "lfg-listed", createdAt: scanStartedAt + 10 },
        { tmuxName: "lfg-new", createdAt: scanStartedAt + 20, spawnedBy: "subagent" },
        { tmuxName: "lfg-dead", createdAt: scanStartedAt + 30, launchState: "failed" },
      ],
      scanStartedAt + 1_000,
      30_000,
    );
    expect(counted).toHaveLength(3);
    expect(counted?.[2]).toEqual({ spawnedBy: "subagent", persistent: undefined, launching: true });
  });

  test("refuses a scan that is too old or missing", () => {
    expect(recentAdmissionSessions(scan, [], scanStartedAt + 30_001, 30_000)).toBeNull();
    expect(recentAdmissionSessions(null, [], scanStartedAt, 30_000)).toBeNull();
  });
});

describe("session list cache latest()", () => {
  test("keeps a finished scan that an invalidate retired, stamped with its start", async () => {
    let finish!: (rows: Session[]) => void;
    const cache = createSessionListCache(
      () => new Promise<Session[]>((resolve) => { finish = resolve; }),
    );
    expect(cache.latest()).toBeNull();
    const before = Date.now();
    const pending = cache.get();
    cache.invalidate();
    finish([{ tmuxName: "lfg-x" } as Session]);
    await pending;
    const latest = cache.latest();
    expect(latest?.sessions).toHaveLength(1);
    expect(latest!.startedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("planSessionCwd", () => {
  test("names the worktree path without creating anything", async () => {
    const repo = join(root, "repo");
    mkdirSync(repo);
    const run = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: repo });
    run(["init", "-q", "-b", "main"]);
    run(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"]);
    const plan = await planSessionCwd(repo, "lfg-plan01");
    expect(plan.cwd).toBe(`${WORKTREE_ROOT}/lfg-plan01`);
    expect(plan.worktree?.branch).toBe("session_lfg-plan01");
    expect(Bun.spawnSync(["git", "worktree", "list"], { cwd: repo }).stdout.toString()).not.toContain("lfg-plan01");
  });

  test("runs in place outside git", async () => {
    const dir = join(root, "plain");
    mkdirSync(dir);
    expect(await planSessionCwd(dir, "lfg-plan02")).toEqual({ cwd: dir });
  });
});
