import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { addManaged, listManaged, removeManaged, resetManagedRegistryForTests, type ManagedSession } from "./managed.ts";
import { launchCodingAgentSession } from "./coding-agent-provider.ts";
import { coldResumeContainment, setRecoveryEgressProxy, type ColdResumeContainment } from "./session-recovery.ts";
import {
  getSessionContainment,
  recordSessionExitReason,
  resetSessionContainmentForTests,
  sessionExitReasons,
} from "./session-containment-record.ts";
import { spawnManagedAisdkSession, spawnManagedCodexAisdkSession } from "./tmux.ts";

// A CLOSED session keeps its launch containment. Close removes the owner row
// and the registry entry, and the transcript scan rewrites the resume-cache
// row with no backend (615b3a99: OOM-killed in lfg-agent-lfg-55531b, closed,
// then resumed outside any unit). Every /api/sessions/resume cold-start branch
// resolves through coldResumeContainment, which must still find it.

const KEY = "615b3a99-a46d-40de-a186-7361bbc911a8";
const NATIVE = "0199aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OLD = "lfg-55531b";
const NEW = "lfg-c105ed";
const linux = process.platform === "linux";
const SLICE = { agentSlice: true, sandbox: "none" as const, egressProxy: false };

type Capture = { cmd: string[]; env: Record<string, string | undefined> };

describe("closed session resume containment", () => {
  const originalData = PATHS.data;
  let root: string;
  let capture: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-closed-containment-"));
    capture = join(root, "launch.json");
    PATHS.data = join(root, "data");
    process.env.LFG_TEST_HARNESS_CAPTURE = capture;
    resetManagedRegistryForTests();
    resetSessionContainmentForTests();
  });

  afterEach(() => {
    delete process.env.LFG_TEST_HARNESS_CAPTURE;
    setRecoveryEgressProxy(null);
    resetManagedRegistryForTests();
    resetSessionContainmentForTests();
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  // Launch, then close: the close path removes the owner row.
  function launchedThenClosed(extra: Partial<ManagedSession>) {
    addManaged({
      tmuxName: OLD,
      cwd: root,
      createdAt: 1,
      agent: "aisdk",
      runtime: "command-file",
      sessionId: KEY,
      nativeSessionId: KEY,
      model: "claude-opus-5-5",
      ...extra,
    });
    removeManaged(OLD);
    expect(listManaged()).toEqual([]);
  }

  function resolved(ids: string[], agent: string, omgId = KEY): ColdResumeContainment {
    const cold = coldResumeContainment(ids, agent, omgId);
    if ("error" in cold) throw new Error(cold.error);
    return cold;
  }

  const launched = (): Capture => JSON.parse(readFileSync(capture, "utf8")) as Capture;

  function expectSlice(cmd: string[]) {
    if (!linux) return;
    expect(cmd[0]).toMatch(/systemd-run$/);
    expect(cmd).toContain(`--unit=lfg-agent-${NEW}`);
    expect(cmd).toContain("--slice=lfg-agents.slice");
    expect(cmd).toContain("--property=MemoryMax=4G");
  }

  function expectNoSlice(cmd: string[]) {
    expect(cmd.some((part) => part.endsWith("systemd-run"))).toBe(false);
  }

  describe("each resume branch finds the record after close", () => {
    test("cachedResume.backend (aisdk): starts in the slice", () => {
      launchedThenClosed({ spawnedBy: "subagent", containment: SLICE });
      const cold = resolved([KEY, KEY], "aisdk");
      expect(cold.source).toBe("record");
      expect(cold.containment).toEqual(SLICE);
      const spawned = launchCodingAgentSession({
        agent: "aisdk", name: NEW, cwd: root, model: "claude-opus-5-5",
        sessionId: KEY, resume: KEY, ...cold.launch,
      });
      expect(spawned.ok).toBe(true);
      expectSlice(launched().cmd);
    });

    test("claude transcript branch: starts in the slice (the 615b3a99 case)", () => {
      launchedThenClosed({ spawnedBy: "subagent", containment: SLICE });
      const cold = resolved([KEY], "aisdk");
      expect(cold.launch.containInAgentSlice).toBe(true);
      expect(spawnManagedAisdkSession({ name: NEW, cwd: root, model: "claude-opus-5-5", sessionId: KEY, ...cold.launch }).ok).toBe(true);
      expectSlice(launched().cmd);
    });

    test("codex transcript branch: found by the rollout (native) id", () => {
      launchedThenClosed({ agent: "codex-aisdk", sessionId: "lfg-old-key", nativeSessionId: NATIVE, containment: SLICE });
      const key = "lfg-new-key";
      const cold = resolved([NATIVE], "codex-aisdk", key);
      expect(cold.source).toBe("record");
      expect(spawnManagedCodexAisdkSession({ name: NEW, cwd: root, model: "gpt-5.5", key, resume: NATIVE, ...cold.launch }).ok).toBe(true);
      expectSlice(launched().cmd);
    });

    test("grok and cursor branch: containInAgentSlice comes from the record", () => {
      for (const agent of ["grok", "cursor"] as const) {
        launchedThenClosed({ agent, runtime: undefined, containment: SLICE });
        const cold = resolved([KEY], agent);
        expect(cold.launch.containInAgentSlice).toBe(true);
        // Those harnesses never took sandbox or egress on first launch.
        expect(cold.launch.sandbox).toBe("none");
      }
    });

    test("jcode branch: the prior row's containment carries over", () => {
      const prior: ManagedSession = {
        tmuxName: OLD, cwd: root, createdAt: 1, agent: "jcode", sessionId: KEY, nativeSessionId: NATIVE, containment: SLICE,
      };
      const cold = coldResumeContainment([KEY, NATIVE], "jcode", KEY, [prior]);
      expect("error" in cold ? cold : cold.launch.containInAgentSlice).toBe(true);
    });

    test("a top-level session closes and resumes without a slice", () => {
      launchedThenClosed({ containment: { agentSlice: false, sandbox: "none", egressProxy: false } });
      const cold = resolved([KEY], "aisdk");
      expect(cold.source).toBe("record");
      expect(spawnManagedAisdkSession({ name: NEW, cwd: root, model: "claude-opus-5-5", sessionId: KEY, ...cold.launch }).ok).toBe(true);
      expectNoSlice(launched().cmd);
    });

    test("a restricted role fails closed without the egress proxy, after close too", () => {
      launchedThenClosed({ role: "guest", containment: { agentSlice: false, sandbox: "none", egressProxy: true } });
      expect(coldResumeContainment([KEY], "aisdk", KEY)).toEqual({ error: "egress proxy unavailable for a restricted session" });
      setRecoveryEgressProxy((id) => `http://${id}:tok@127.0.0.1:9999`);
      const cold = resolved([KEY], "aisdk");
      expect(cold.role).toBe("guest");
      expect(spawnManagedAisdkSession({ name: NEW, cwd: root, model: "claude-opus-5-5", sessionId: KEY, ...cold.launch }).ok).toBe(true);
      expect(launched().env.HTTP_PROXY).toBe(`http://${KEY}:tok@127.0.0.1:9999`);
    });
  });

  describe("legacy: closed before the record existed", () => {
    function conversations(rows: unknown[]) {
      mkdirSync(join(PATHS.data, "conversations"), { recursive: true });
      writeFileSync(join(PATHS.data, "conversations", "conversations.json"), JSON.stringify(rows));
    }
    const attached = (id: string, kind?: "thread") => ({
      id,
      ...(kind ? { kind } : {}),
      participants: [],
      runtimeSessions: [
        { sessionId: id, kind: "primary", attachedAt: 1 },
        { sessionId: KEY, kind: "execution", attachedAt: 2 },
      ],
      createdAt: 1,
      updatedAt: 2,
    });

    test("a subagent or bot runtime (execution under another conversation) defaults to the slice", () => {
      conversations([attached("63c5d565-db00-4f4b-97fe-b1399a3fc5ac")]);
      const cold = resolved([KEY], "aisdk");
      expect(cold.source).toBe("delegated");
      expect(cold.launch.containInAgentSlice).toBe(true);
    });

    test("a thread task is a human session and stays uncontained", () => {
      conversations([attached("thread-1", "thread")]);
      expect(resolved([KEY], "aisdk").launch.containInAgentSlice).toBe(false);
    });

    test("no trace at all stays uncontained", () => {
      const cold = resolved([KEY], "aisdk");
      expect(cold.source).toBe("none");
      expect(cold.launch.containInAgentSlice).toBe(false);
    });

    test("removeManaged keeps a record for a row that never had one", () => {
      launchedThenClosed({ spawnedBy: "bot" });
      expect(getSessionContainment([KEY])?.agentSlice).toBe(true);
    });
  });

  describe("exit reason", () => {
    test("an OOM close is kept for the picker, and a new launch clears it", () => {
      launchedThenClosed({ spawnedBy: "subagent", containment: SLICE });
      recordSessionExitReason([KEY], "out_of_memory");
      expect(sessionExitReasons([KEY, "other"]).get(KEY)).toBe("out_of_memory");
      // A later removeManaged backfill must not overwrite it.
      removeManaged(OLD);
      expect(getSessionContainment([KEY])?.exitReason).toBe("out_of_memory");
      addManaged({ tmuxName: NEW, cwd: root, createdAt: 3, sessionId: KEY, containment: SLICE });
      expect(sessionExitReasons([KEY]).size).toBe(0);
    });
  });
});
