import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { appendCmd, cmdPath, currentBootId, isEntryBusy, readEntry, writeEntry } from "./aisdk-registry.ts";
import { initialCmdOffset, readNewCmdLines, writeCursor } from "./agents/backends/cmd-tail.ts";
import { addManaged, listManaged, resetManagedRegistryForTests } from "./managed.ts";
import {
  HARNESS_RELAUNCH_CLAIM_MS,
  launchRecovered,
  relaunchDeadCommandFileHarness,
} from "./session-recovery.ts";
import { managedLaunchRow } from "./sessions.ts";
import { indexSessionMessagesDirect } from "./transcript-index.ts";

const KEY = "de7fd537-11e6-4969-91be-17010bf08070";
const DEAD_PID = 2147483646;

describe("relaunching a dead command-file harness on send", () => {
  const originalData = PATHS.data;
  let root: string;
  let capture: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-session-relaunch-"));
    capture = join(root, "launch.json");
    PATHS.data = join(root, "data");
    process.env.LFG_TEST_HARNESS_CAPTURE = capture;
    resetManagedRegistryForTests();
    addManaged({
      tmuxName: "lfg-c3fbb9",
      cwd: root,
      createdAt: 1,
      agent: "aisdk",
      runtime: "command-file",
      sessionId: KEY,
      nativeSessionId: KEY,
      model: "claude-opus-5-5",
      claudeAccountId: "acct-1",
      launchState: "running",
    });
  });

  afterEach(() => {
    delete process.env.LFG_TEST_HARNESS_CAPTURE;
    resetManagedRegistryForTests();
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  function entry(pid: number, bootId: string | null = currentBootId()) {
    writeEntry({
      sessionId: KEY,
      agent: "claude",
      harnessPid: pid,
      tmuxName: "lfg-c3fbb9",
      supervisor: "process",
      bootId,
      cwd: root,
      model: "claude-opus-5-5",
      // What an OOM kill leaves behind: the finally that clears busy never ran.
      busy: true,
      createdAt: 2,
    });
  }

  test("dead harness: relaunches the same row, and a message sent after is read by the new harness", () => {
    entry(DEAD_PID);
    // A message that went in while nobody was reading, then the cursor the
    // dead harness last wrote.
    appendCmd(KEY, { type: "send", text: "stuck message" });
    const cmdFile = cmdPath(KEY);
    writeCursor(cmdFile, 0);

    const result = relaunchDeadCommandFileHarness(KEY, { log: () => {} });
    expect(result.state).toBe("relaunched");
    const launch = JSON.parse(readFileSync(capture, "utf8")) as { cmd: string[] };
    const at = (flag: string) => launch.cmd[launch.cmd.indexOf(flag) + 1];
    expect(at("--session")).toBe(KEY);
    expect(at("--managed-name")).toBe("lfg-c3fbb9");
    expect(at("--model")).toBe("claude-opus-5-5");
    expect(at("--claude-account")).toBe("acct-1");
    expect(launch.cmd).toContain("--recovered-at");

    const after = readEntry(KEY)!;
    expect(after.busy).toBe(false);
    expect(after.relaunchClaimedAt).toEqual(expect.any(Number));
    expect(listManaged()[0]).toEqual(expect.objectContaining({ launchState: "running", interruptedAt: expect.any(Number) }));

    // Delivery: what sendPromptToLiveSession appends next is read by the new
    // harness from the persisted cursor, together with the stuck message.
    appendCmd(KEY, { type: "send", text: "continue please" });
    const { lines } = readNewCmdLines(cmdFile, initialCmdOffset(cmdFile));
    expect(lines.map((line) => JSON.parse(line).text)).toEqual(["stuck message", "continue please"]);
  });

  test("a pid recorded by a prior boot counts as dead", () => {
    entry(process.pid, "some-other-boot");
    let launches = 0;
    const result = relaunchDeadCommandFileHarness(KEY, {
      log: () => {},
      launch: () => {
        launches++;
        return { ok: true, pid: DEAD_PID };
      },
    });
    expect(currentBootId() ? result.state : "relaunched").toBe("relaunched");
    expect(launches).toBe(currentBootId() ? 1 : 0);
  });

  test("live harness: no relaunch", () => {
    entry(process.pid);
    let launches = 0;
    const result = relaunchDeadCommandFileHarness(KEY, {
      log: () => {},
      launch: () => {
        launches++;
        return { ok: true };
      },
    });
    expect(result.state).toBe("alive");
    expect(launches).toBe(0);
    expect(existsSync(capture)).toBe(false);
  });

  test("concurrent sends: exactly one spawn", async () => {
    entry(DEAD_PID);
    let launches = 0;
    // The spawned wrapper is still running while the new harness boots.
    const launch: typeof launchRecovered = () => {
      launches++;
      return { ok: true, pid: process.pid };
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, async () => relaunchDeadCommandFileHarness(KEY, { log: () => {}, launch })),
    );
    expect(launches).toBe(1);
    expect(results.map((r) => r.state).sort()).toEqual(["claimed", "claimed", "claimed", "claimed", "relaunched"]);
  });

  test("the claim lapses when the replacement died or the window passed", () => {
    entry(DEAD_PID);
    let launches = 0;
    let now = 1_000_000;
    const launch: typeof launchRecovered = () => {
      launches++;
      return { ok: true, pid: DEAD_PID - 1 };
    };
    expect(relaunchDeadCommandFileHarness(KEY, { log: () => {}, launch, now: () => now }).state).toBe("relaunched");
    // The replacement pid is dead: the next send may try again.
    expect(relaunchDeadCommandFileHarness(KEY, { log: () => {}, launch, now: () => now + 1 }).state).toBe("relaunched");
    expect(launches).toBe(2);

    const liveWrapper: typeof launchRecovered = () => {
      launches++;
      return { ok: true, pid: process.pid };
    };
    now += 10;
    expect(relaunchDeadCommandFileHarness(KEY, { log: () => {}, launch: liveWrapper, now: () => now }).state).toBe("relaunched");
    expect(relaunchDeadCommandFileHarness(KEY, { log: () => {}, launch: liveWrapper, now: () => now + 5 }).state).toBe("claimed");
    expect(
      relaunchDeadCommandFileHarness(KEY, {
        log: () => {},
        launch: liveWrapper,
        now: () => now + HARNESS_RELAUNCH_CLAIM_MS + 1,
      }).state,
    ).toBe("relaunched");
    expect(launches).toBe(4);
  });

  test("a failed relaunch marks the row failed and releases the claim", () => {
    entry(DEAD_PID);
    const result = relaunchDeadCommandFileHarness(KEY, {
      log: () => {},
      launch: () => ({ ok: false, error: "boom" }),
    });
    expect(result).toEqual({ state: "failed", error: "boom" });
    expect(readEntry(KEY)?.relaunchClaimedAt).toBeNull();
    expect(listManaged()[0]).toEqual(expect.objectContaining({ launchState: "failed", launchError: "boom" }));
  });

  test("a session with no registry entry is left to the cold-start path", () => {
    expect(relaunchDeadCommandFileHarness(KEY, { log: () => {} }).state).toBe("unknown");
  });

  test("the list shows a killed harness as interrupted and not busy, not as a provider error", () => {
    entry(DEAD_PID);
    indexSessionMessagesDirect(KEY, [
      { id: "u1", role: "user", kind: "text", text: "build it", ts: 10 },
      { id: "a1", role: "assistant", kind: "text", text: "working on it", ts: 11 },
    ]);
    const row = managedLaunchRow(listManaged()[0]!, {}, {});
    expect(row).not.toBeNull();
    expect(row!.pid).toBe(0);
    // The entry still says busy:true; the list must not believe it.
    expect(readEntry(KEY)?.busy).toBe(true);
    expect(isEntryBusy(readEntry(KEY)!)).toBe(false);
    expect(row!.status).toBe("blocked");
    expect(row!.statusReason).toBe("interrupted");
  });
});
