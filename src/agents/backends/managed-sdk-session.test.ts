import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCmd, readEntry, wakeHarnessCommandReader } from "../../aisdk-registry.ts";
import { PATHS } from "../../config.ts";
import { indexedRecentMessages, sessionIndexKey, resetTranscriptIndexConnectionForTests } from "../../transcript-index.ts";
import {
  managedRestartFreshNotice,
  managedRestartResumedNotice,
  runManagedSdkSession,
  type ManagedSdkRestart,
  type ManagedSdkRuntime,
} from "./managed-sdk-session.ts";

const originalData = PATHS.data;
const originalCwd = process.cwd();
const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lfg-managed-sdk-"));
  PATHS.data = join(root, "data");
  resetTranscriptIndexConnectionForTests();
});

afterEach(() => {
  // The harness normally runs in its own process and changes its cwd.
  // Restore the test runner before removing that harness's workspace.
  process.chdir(originalCwd);
  resetTranscriptIndexConnectionForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await Bun.sleep(20);
  }
}

describe("managed SDK startup journaling and first-launch commands", () => {
  test("a background maintenance notice preserves the active draft and busy state", async () => {
    let release = () => {};
    let notify = () => {};
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const done = runManagedSdkSession({
      key: KEY, agent: "copilot", cwd: root, model: "auto", managedName: "maintenance-notice",
      initialPrompt: "work", exitProcess: () => {},
      async createRuntime(sink) {
        notify = () => sink.notice?.("Maintenance could not complete.");
        return {
          nativeSessionId: "native-copilot",
          async runTurn() {
            await Bun.sleep(170);
            sink.draft("Answer in progress");
            await paused;
            return { text: "Answer complete" };
          },
          interrupt() {}, close() {},
        };
      },
    });
    try {
      await waitFor(() => readEntry(KEY)?.draftText === "Answer in progress");
      notify();
      expect(readEntry(KEY)?.busy).toBe(true);
      expect(readEntry(KEY)?.draftText).toBe("Answer in progress");
      const rows = await indexedRecentMessages(sessionIndexKey(KEY), KEY);
      expect(rows.some((row) => row.text === "Maintenance could not complete.")).toBe(true);
    } finally {
      release();
      appendCmd(KEY, { type: "close" });
      wakeHarnessCommandReader(readEntry(KEY)!);
      await done;
    }
  });
  test("marks live reasoning drafts so clients do not render them as answer text", async () => {
    let releaseThought = () => {};
    let releaseAnswer = () => {};
    const thoughtPaused = new Promise<void>((resolve) => {
      releaseThought = resolve;
    });
    const answerPaused = new Promise<void>((resolve) => {
      releaseAnswer = resolve;
    });
    const done = runManagedSdkSession({
      key: KEY,
      agent: "grok",
      cwd: root,
      model: "grok-4.6",
      managedName: "lfg-draft-kind",
      exitProcess: () => {},
      async createRuntime(sink) {
        return {
          nativeSessionId: "native-grok-draft-kind",
          async runTurn() {
            await Bun.sleep(170);
            sink.thinking("private plan");
            await thoughtPaused;
            await Bun.sleep(170);
            sink.draft("public answer");
            await answerPaused;
            return { text: "public answer", thinking: "private plan" };
          },
          interrupt() {},
          close() {},
        };
      },
    });

    await waitFor(() => readEntry(KEY)?.commandWakeSignal === "SIGUSR1");
    appendCmd(KEY, { type: "send", text: "go" });
    wakeHarnessCommandReader(readEntry(KEY)!);
    await waitFor(() => readEntry(KEY)?.draftText === "private plan");
    expect(readEntry(KEY)?.draftKind).toBe("thinking");

    releaseThought();
    await waitFor(() => readEntry(KEY)?.draftText === "public answer");
    expect(readEntry(KEY)?.draftKind).toBe("text");

    releaseAnswer();
    await waitFor(() => readEntry(KEY)?.busy === false);
    expect(readEntry(KEY)?.draftKind ?? null).toBeNull();
    appendCmd(KEY, { type: "close" });
    wakeHarnessCommandReader(readEntry(KEY)!);
    await done;
  });

  test("writes a recoverable registry entry before createRuntime connects", async () => {
    let resumeConnect = () => {};
    const connecting = new Promise<void>((resolve) => {
      resumeConnect = resolve;
    });
    const turns: string[] = [];
    const done = runManagedSdkSession({
      key: KEY,
      agent: "grok",
      cwd: root,
      model: "grok-code-fast-1",
      managedName: "lfg-startup",
      exitProcess: () => {},
      async createRuntime() {
        expect(readEntry(KEY)).toEqual(expect.objectContaining({
          sessionId: KEY,
          agent: "grok",
          harnessPid: process.pid,
          tmuxName: "lfg-startup",
          supervisor: "process",
          threadId: null,
        }));
        expect(readEntry(KEY)?.commandWakeSignal).toBeUndefined();
        await connecting;
        return {
          nativeSessionId: "native-grok-1",
          async runTurn(prompt) {
            turns.push(prompt);
            return { text: "ok" };
          },
          interrupt() {},
          close() {},
        };
      },
    });

    await waitFor(() => readEntry(KEY) != null);
    expect(readEntry(KEY)?.threadId ?? null).toBeNull();
    resumeConnect();
    await waitFor(() => readEntry(KEY)?.threadId === "native-grok-1");
    expect(readEntry(KEY)?.commandWakeSignal).toBe("SIGUSR1");
    appendCmd(KEY, { type: "close" });
    wakeHarnessCommandReader(readEntry(KEY)!);
    await done;
  });

  test("wakes a close command without waiting for the 250 ms poll", async () => {
    const done = runManagedSdkSession({
      key: KEY,
      agent: "cursor",
      cwd: root,
      model: "auto",
      managedName: "lfg-wake-close",
      exitProcess: () => {},
      async createRuntime() {
        return {
          nativeSessionId: "native-cursor-wake",
          async runTurn() {
            return { text: "ok" };
          },
          interrupt() {},
          close() {},
        };
      },
    });

    await waitFor(() => readEntry(KEY)?.commandWakeSignal === "SIGUSR1");
    const entry = readEntry(KEY)!;
    appendCmd(KEY, { type: "close" });
    expect(wakeHarnessCommandReader(entry)).toBe(true);
    const outcome = await Promise.race([
      done.then(() => "closed"),
      Bun.sleep(150).then(() => "timeout"),
    ]);
    expect(outcome).toBe("closed");
  });

  test("delivers first-launch commands that arrive while createRuntime connects", async () => {
    let resumeConnect = () => {};
    const connecting = new Promise<void>((resolve) => {
      resumeConnect = resolve;
    });
    const turns: string[] = [];
    const done = runManagedSdkSession({
      key: KEY,
      agent: "cursor",
      cwd: root,
      model: "auto",
      managedName: "lfg-first-send",
      exitProcess: () => {},
      async createRuntime() {
        await connecting;
        return {
          nativeSessionId: "native-cursor-1",
          async runTurn(prompt) {
            turns.push(prompt);
            return { text: "ok" };
          },
          interrupt() {},
          close() {},
        };
      },
    });

    await waitFor(() => readEntry(KEY) != null);
    appendCmd(KEY, { type: "send", text: "hello while connecting" });
    resumeConnect();
    await waitFor(() => turns.includes("hello while connecting"));
    appendCmd(KEY, { type: "close" });
    await done;
    expect(turns).toEqual(["hello while connecting"]);
  });

  test("recovery without a cursor does not replay historical commands", async () => {
    appendCmd(KEY, { type: "send", text: "already delivered last boot" });
    const turns: string[] = [];
    const done = runManagedSdkSession({
      key: KEY,
      agent: "copilot",
      cwd: root,
      model: "auto",
      managedName: "lfg-old-row",
      recoveredAt: Date.now(),
      resume: "native-copilot-1",
      exitProcess: () => {},
      async createRuntime() {
        return {
          nativeSessionId: "native-copilot-1",
          async runTurn(prompt) {
            turns.push(prompt);
            return { text: "ok" };
          },
          interrupt() {},
          close() {},
        };
      },
    });

    await waitFor(() => readEntry(KEY)?.threadId === "native-copilot-1");
    appendCmd(KEY, { type: "send", text: "new after recovery" });
    await waitFor(() => turns.includes("new after recovery"));
    appendCmd(KEY, { type: "close" });
    await done;
    expect(turns).toEqual(["new after recovery"]);
  });

  test("keeps the registry entry when createRuntime fails", async () => {
    await expect(runManagedSdkSession({
      key: KEY,
      agent: "jcode",
      cwd: root,
      model: "auto",
      managedName: "lfg-failed-start",
      resume: "native-jcode-1",
      exitProcess: () => {},
      async createRuntime() {
        expect(readEntry(KEY)?.threadId).toBe("native-jcode-1");
        throw new Error("provider handshake failed");
      },
    })).rejects.toThrow("provider handshake failed");
    expect(readEntry(KEY)).toEqual(expect.objectContaining({
      sessionId: KEY,
      agent: "jcode",
      threadId: "native-jcode-1",
      harnessPid: process.pid,
    }));
  });
});

describe("managed SDK questions answered by a typed message", () => {
  async function run(reply: string) {
    const turns: string[] = [];
    const picks: Array<number | null> = [];
    const done = runManagedSdkSession({
      key: KEY,
      agent: "grok",
      cwd: root,
      model: "grok-4.6",
      managedName: "lfg-ask-text",
      exitProcess: () => {},
      async createRuntime(sink) {
        return {
          nativeSessionId: "native-ask-text",
          async runTurn(prompt) {
            turns.push(prompt);
            if (prompt === "go") picks.push(await sink.ask("Ship it?", [{ label: "Yes" }, { label: "No" }]));
            return { text: "ok" };
          },
          interrupt() {},
          close() {},
        };
      },
    });
    await waitFor(() => readEntry(KEY)?.commandWakeSignal === "SIGUSR1");
    appendCmd(KEY, { type: "send", text: "go" });
    wakeHarnessCommandReader(readEntry(KEY)!);
    await waitFor(() => readEntry(KEY)?.prompt?.question === "Ship it?");
    appendCmd(KEY, { type: "send", text: reply });
    wakeHarnessCommandReader(readEntry(KEY)!);
    await waitFor(() => picks.length === 1);
    await waitFor(() => readEntry(KEY)?.busy === false);
    appendCmd(KEY, { type: "close" });
    wakeHarnessCommandReader(readEntry(KEY)!);
    await done;
    return { turns, picks };
  }

  test("an exact option label answers the open question", async () => {
    const { turns, picks } = await run("no");
    expect(picks).toEqual([1]);
    expect(turns).toEqual(["go"]);
  });

  test("other text closes the question and reaches the agent as the next message", async () => {
    const { turns, picks } = await run("wait until the tests pass");
    expect(picks).toEqual([null]);
    expect(turns).toEqual(["go", "wait until the tests pass"]);
  });
});

describe("managed SDK runtime whose agent process ended between turns", () => {
  type FakeRuntime = ManagedSdkRuntime & { dead: boolean; prompts: string[]; closed: boolean };

  function fakeRuntime(nativeSessionId: string): FakeRuntime {
    const runtime: FakeRuntime = {
      nativeSessionId,
      dead: false,
      prompts: [],
      closed: false,
      alive: () => !runtime.dead,
      async runTurn(prompt) {
        if (runtime.dead) throw new Error("ACP connection closed");
        runtime.prompts.push(prompt);
        return { text: `${nativeSessionId}: ${prompt}` };
      },
      interrupt() {},
      close() {
        runtime.closed = true;
      },
    };
    return runtime;
  }

  async function texts(): Promise<string[]> {
    return (await indexedRecentMessages(sessionIndexKey(KEY), KEY)).map((row) => row.text);
  }

  async function send(text: string): Promise<void> {
    appendCmd(KEY, { type: "send", text });
    wakeHarnessCommandReader(readEntry(KEY)!);
  }

  async function stop(done: Promise<void>): Promise<void> {
    appendCmd(KEY, { type: "close" });
    wakeHarnessCommandReader(readEntry(KEY)!);
    await done;
  }

  test("replaces the runtime and resumes the same conversation on the next turn", async () => {
    const created: FakeRuntime[] = [];
    const restarts: (ManagedSdkRestart | undefined)[] = [];
    const done = runManagedSdkSession({
      key: KEY, agent: "grok", cwd: root, model: "grok-5", thinkingLevel: "high",
      managedName: "restart-resume", initialPrompt: "first", exitProcess: () => {},
      async createRuntime(_sink, restart) {
        restarts.push(restart);
        const runtime = fakeRuntime("native-grok-1");
        created.push(runtime);
        return runtime;
      },
    });
    try {
      await waitFor(() => created[0]?.prompts.includes("first") === true);
      // What `pkill -f "agy acp"` did to idle sessions on 2026-11-18.
      created[0]!.dead = true;
      await send("still there?");
      await waitFor(() => created[1]?.prompts.includes("still there?") === true);

      expect(restarts).toEqual([undefined, { resume: "native-grok-1", model: "grok-5", thinkingLevel: "high" }]);
      expect(created[0]!.closed).toBe(true);
      await waitFor(() => readEntry(KEY)?.busy === false);
      const rows = await texts();
      expect(rows).toContain(managedRestartResumedNotice("grok"));
      expect(rows).toContain("native-grok-1: still there?");
      expect(rows.some((text) => text.includes("turn failed"))).toBe(false);
    } finally {
      await stop(done);
    }
  });

  test("says the agent starts fresh when the replacement could not resume", async () => {
    const created: FakeRuntime[] = [];
    const done = runManagedSdkSession({
      key: KEY, agent: "devin", cwd: root, model: "auto",
      managedName: "restart-fresh", initialPrompt: "first", exitProcess: () => {},
      async createRuntime() {
        const runtime = fakeRuntime(`native-devin-${created.length + 1}`);
        created.push(runtime);
        return runtime;
      },
    });
    try {
      await waitFor(() => created[0]?.prompts.includes("first") === true);
      created[0]!.dead = true;
      await send("again");
      await waitFor(() => created[1]?.prompts.includes("again") === true);
      await waitFor(() => readEntry(KEY)?.busy === false);
      expect(await texts()).toContain(managedRestartFreshNotice("devin"));
      expect(readEntry(KEY)?.threadId).toBe("native-devin-2");
    } finally {
      await stop(done);
    }
  });

  test("a failed replacement fails that turn and the next turn tries again", async () => {
    const created: FakeRuntime[] = [];
    let failNext = false;
    const done = runManagedSdkSession({
      key: KEY, agent: "cursor", cwd: root, model: "auto",
      managedName: "restart-retry", initialPrompt: "first", exitProcess: () => {},
      async createRuntime() {
        if (failNext) {
          failNext = false;
          throw new Error("cursor-agent is not signed in");
        }
        const runtime = fakeRuntime("native-cursor-1");
        created.push(runtime);
        return runtime;
      },
    });
    try {
      await waitFor(() => created[0]?.prompts.includes("first") === true);
      created[0]!.dead = true;
      failNext = true;
      await send("one");
      const failed = "cursor turn failed: cursor-agent is not signed in";
      for (let i = 0; i < 100 && !(await texts()).includes(failed); i++) await Bun.sleep(20);
      expect(created).toHaveLength(1);
      await send("two");
      await waitFor(() => created[1]?.prompts.includes("two") === true);
      const rows = await texts();
      expect(rows).toContain(failed);
      expect(rows).toContain("native-cursor-1: two");
    } finally {
      await stop(done);
    }
  });

  test("a runtime without an alive check is never replaced", async () => {
    let creations = 0;
    const done = runManagedSdkSession({
      key: KEY, agent: "copilot", cwd: root, model: "auto",
      managedName: "restart-none", initialPrompt: "first", exitProcess: () => {},
      async createRuntime() {
        creations++;
        return {
          nativeSessionId: "native-copilot",
          async runTurn() {
            return { text: "ok" };
          },
          interrupt() {},
          close() {},
        };
      },
    });
    try {
      await send("second");
      await waitFor(() => readEntry(KEY)?.busy === false);
      await Bun.sleep(50);
      expect(creations).toBe(1);
    } finally {
      await stop(done);
    }
  });
});
