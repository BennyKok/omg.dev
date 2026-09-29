import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { currentBootId, writeEntry } from "./aisdk-registry.ts";
import { addManaged, listManaged, resetManagedRegistryForTests, type ManagedSession } from "./managed.ts";
import {
  managedContainment,
  reconcileCommandFileSessions,
  relaunchDeadCommandFileHarness,
  setRecoveryEgressProxy,
} from "./session-recovery.ts";
import { managedLaunchRow } from "./sessions.ts";
import { indexSessionMessagesDirect } from "./transcript-index.ts";
import { agentUnitName, journalShowsOomKill, setJournalReaderForTests } from "./agent-unit-oom.ts";

// A relaunch after an OOM kill (or a reboot) must come back in the same
// containment as the first spawn: a subagent in its lfg-agent-<name> unit, a
// top-level session without one.

const KEY = "4d5404ad-79df-4e10-b8a5-0d2772fa9acc";
const NAME = "lfg-437797";
const DEAD_PID = 2147483646;
const linux = process.platform === "linux";

type Capture = { cmd: string[]; env: Record<string, string | undefined> };

describe("relaunch containment", () => {
  const originalData = PATHS.data;
  let root: string;
  let capture: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-relaunch-containment-"));
    capture = join(root, "launch.json");
    PATHS.data = join(root, "data");
    process.env.LFG_TEST_HARNESS_CAPTURE = capture;
    resetManagedRegistryForTests();
  });

  afterEach(() => {
    delete process.env.LFG_TEST_HARNESS_CAPTURE;
    setRecoveryEgressProxy(null);
    setJournalReaderForTests(null);
    resetManagedRegistryForTests();
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  function row(extra: Partial<ManagedSession>) {
    addManaged({
      tmuxName: NAME,
      cwd: root,
      createdAt: 1,
      agent: "aisdk",
      runtime: "command-file",
      sessionId: KEY,
      nativeSessionId: KEY,
      model: "claude-opus-5-5",
      launchState: "running",
      ...extra,
    });
  }

  function deadEntry(bootId: string | null = currentBootId()) {
    writeEntry({
      sessionId: KEY,
      agent: "claude",
      harnessPid: DEAD_PID,
      tmuxName: NAME,
      supervisor: "process",
      bootId,
      cwd: root,
      model: "claude-opus-5-5",
      busy: true,
      createdAt: 2,
    });
  }

  const launched = (): Capture => JSON.parse(readFileSync(capture, "utf8")) as Capture;

  function expectSlice(cmd: string[]) {
    if (!linux) return;
    expect(cmd[0]).toMatch(/systemd-run$/);
    expect(cmd).toContain(`--unit=lfg-agent-${NAME}`);
    expect(cmd).toContain("--slice=lfg-agents.slice");
    expect(cmd).toContain("--property=MemoryMax=2G");
    expect(cmd).toContain("--property=KillMode=control-group");
  }

  function expectNoSlice(cmd: string[]) {
    expect(cmd.some((part) => part.endsWith("systemd-run"))).toBe(false);
    expect(cmd.some((part) => part.startsWith("--slice="))).toBe(false);
  }

  const relaunch = () => relaunchDeadCommandFileHarness(KEY, { log: () => {} });

  test("send: a subagent spawned in the slice is relaunched in the slice", () => {
    row({ spawnedBy: "subagent", containment: { agentSlice: true, sandbox: "none", egressProxy: false } });
    deadEntry();
    expect(relaunch().state).toBe("relaunched");
    expectSlice(launched().cmd);
  });

  test("send: a top-level session without a slice stays without one", () => {
    row({ containment: { agentSlice: false, sandbox: "none", egressProxy: false } });
    deadEntry();
    expect(relaunch().state).toBe("relaunched");
    expectNoSlice(launched().cmd);
  });

  test("the record wins over spawnedBy, so the caller cannot change the limit", () => {
    row({ spawnedBy: "subagent", containment: { agentSlice: false, sandbox: "none", egressProxy: false } });
    deadEntry();
    expect(relaunch().state).toBe("relaunched");
    expectNoSlice(launched().cmd);
  });

  test("boot recovery: a subagent comes back in the slice", async () => {
    row({ spawnedBy: "subagent", containment: { agentSlice: true, sandbox: "none", egressProxy: false } });
    deadEntry("prior-boot");
    const result = await reconcileCommandFileSessions(() => {});
    expect(result.recovered).toBe(1);
    expectSlice(launched().cmd);
  });

  test("boot recovery: a top-level session comes back without a slice", async () => {
    row({ containment: { agentSlice: false, sandbox: "none", egressProxy: false } });
    deadEntry("prior-boot");
    const result = await reconcileCommandFileSessions(() => {});
    expect(result.recovered).toBe(1);
    expectNoSlice(launched().cmd);
  });

  test("legacy subagent row without a record defaults to the slice", async () => {
    row({ spawnedBy: "subagent" });
    expect(listManaged()[0]!.containment).toBeUndefined();
    deadEntry();
    expect(relaunch().state).toBe("relaunched");
    expectSlice(launched().cmd);
  });

  test("legacy subagent row: boot recovery also defaults to the slice", async () => {
    row({ spawnedBy: "subagent" });
    deadEntry("prior-boot");
    expect((await reconcileCommandFileSessions(() => {})).recovered).toBe(1);
    expectSlice(launched().cmd);
  });

  test("legacy top-level row without a record stays uncontained", () => {
    row({});
    deadEntry();
    expect(relaunch().state).toBe("relaunched");
    expectNoSlice(launched().cmd);
  });

  test("legacy defaults: subagent and bot rows are contained, others are not", () => {
    const base = { tmuxName: NAME, cwd: root, createdAt: 1 };
    expect(managedContainment({ ...base, spawnedBy: "subagent" }).agentSlice).toBe(true);
    expect(managedContainment({ ...base, spawnedBy: "bot" }).agentSlice).toBe(true);
    expect(managedContainment({ ...base, spawnedBy: "fork" }).agentSlice).toBe(false);
    expect(managedContainment(base)).toEqual({ agentSlice: false, sandbox: "none", egressProxy: false });
  });

  test("a restricted session is relaunched behind the egress proxy, and fails closed without it", () => {
    row({ containment: { agentSlice: false, sandbox: "none", egressProxy: true } });
    deadEntry();
    const failed = relaunch();
    expect(failed.state).toBe("failed");

    setRecoveryEgressProxy((id) => `http://${id}:tok@127.0.0.1:9999`);
    deadEntry();
    expect(relaunch().state).toBe("relaunched");
    expect(launched().env.HTTP_PROXY).toBe(`http://${KEY}:tok@127.0.0.1:9999`);
  });

  describe("out-of-memory status", () => {
    const OOM_JOURNAL = [
      `${agentUnitName(NAME)}: The kernel OOM killer killed some processes in this unit.`,
      `${agentUnitName(NAME)}: Failed with result 'oom-kill'.`,
    ].join("\n");

    function explained() {
      indexSessionMessagesDirect(KEY, [
        { id: "u1", role: "user", kind: "text", text: "build it", ts: 10 },
        { id: "a1", role: "assistant", kind: "text", text: "working on it", ts: 11 },
      ]);
    }

    test("journal parser matches the real systemd lines", () => {
      expect(journalShowsOomKill(OOM_JOURNAL)).toBe(true);
      expect(journalShowsOomKill(`${agentUnitName(NAME)}: Deactivated successfully.`)).toBe(false);
    });

    test("a contained harness OOM-killed in its unit reads out_of_memory with the unit name", () => {
      const asked: string[] = [];
      setJournalReaderForTests((unit) => {
        asked.push(unit);
        return OOM_JOURNAL;
      });
      row({ spawnedBy: "subagent", containment: { agentSlice: true, sandbox: "none", egressProxy: false } });
      deadEntry();
      explained();
      const listed = managedLaunchRow(listManaged()[0]!, {}, {})!;
      expect(listed.statusReason).toBe("out_of_memory");
      expect(listed.statusDetail).toBe("lfg-agent-lfg-437797.service");
      // Cached per dead harness: a second list refresh does not re-read the journal.
      managedLaunchRow(listManaged()[0]!, {}, {});
      expect(asked).toEqual(["lfg-agent-lfg-437797.service"]);
    });

    test("no OOM line in the journal stays interrupted", () => {
      setJournalReaderForTests(() => `${agentUnitName(NAME)}: Main process exited, code=killed, status=9/KILL`);
      row({ spawnedBy: "subagent", containment: { agentSlice: true, sandbox: "none", egressProxy: false } });
      deadEntry();
      explained();
      expect(managedLaunchRow(listManaged()[0]!, {}, {})!.statusReason).toBe("interrupted");
    });

    test("an uncontained harness has no unit, so the journal is not read", () => {
      let reads = 0;
      setJournalReaderForTests(() => {
        reads++;
        return OOM_JOURNAL;
      });
      row({ containment: { agentSlice: false, sandbox: "none", egressProxy: false } });
      deadEntry();
      explained();
      expect(managedLaunchRow(listManaged()[0]!, {}, {})!.statusReason).toBe("interrupted");
      expect(reads).toBe(0);
    });
  });
});
