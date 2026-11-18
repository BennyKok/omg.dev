// End to end: a managed Antigravity session over a fake `agy acp`, through
// runManagedSdkSession, the same path a message from the web UI takes.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCmd, readEntry, wakeHarnessCommandReader, type AisdkCommand } from "../../aisdk-registry.ts";
import { PATHS } from "../../config.ts";
import { indexedRecentMessages, resetTranscriptIndexConnectionForTests, sessionIndexKey } from "../../transcript-index.ts";
import { antigravityRuntimeFactory } from "./antigravity-acp-session.ts";
import { managedRestartResumedNotice, runManagedSdkSession } from "./managed-sdk-session.ts";

const FAKE_AGY = join(import.meta.dir, "fixtures", "fake-agy-acp.ts");
const KEY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Logged = { pid: number; method: string; params?: Record<string, unknown> };

const originalData = PATHS.data;
const originalCwd = process.cwd();
const saved = { path: process.env.LFG_ANTIGRAVITY_PATH, log: process.env.FAKE_AGY_LOG };
let root = "";
let logPath = "";
let done: Promise<void> | null = null;

function logged(): Logged[] {
  return readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

async function texts(): Promise<string[]> {
  return (await indexedRecentMessages(sessionIndexKey(KEY), KEY)).map((row) => row.text);
}

async function waitForText(text: string): Promise<void> {
  for (let i = 0; i < 150; i++) {
    if ((await texts()).includes(text)) return;
    await Bun.sleep(20);
  }
  throw new Error(`timed out waiting for ${JSON.stringify(text)}; saw ${JSON.stringify(await texts())}`);
}

/** Until the fake agy has received its first prompt. */
async function waitForPrompt(): Promise<void> {
  for (let i = 0; i < 150; i++) {
    try {
      if (logged().some((entry) => entry.method === "session/prompt")) return;
    } catch {}
    await Bun.sleep(20);
  }
  throw new Error("timed out waiting for the first prompt");
}

function command(cmd: AisdkCommand): void {
  appendCmd(KEY, cmd);
  wakeHarnessCommandReader(readEntry(KEY)!);
}

async function killAgy(pid: number): Promise<void> {
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      break;
    }
    await Bun.sleep(10);
  }
  // Let the child's exit event reach the runtime.
  await Bun.sleep(50);
}

function start(thinkingLevel: string): void {
  done = runManagedSdkSession({
    key: KEY,
    agent: "antigravity",
    cwd: root,
    model: "default",
    managedName: "agy-restart",
    thinkingLevel,
    initialPrompt: "hello",
    exitProcess: () => {},
    createRuntime: antigravityRuntimeFactory({
      key: KEY,
      cwd: root,
      model: "default",
      thinkingLevel,
      recordLevels: async () => {},
    }),
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agy-runtime-"));
  logPath = join(root, "agy.log");
  PATHS.data = join(root, "data");
  resetTranscriptIndexConnectionForTests();
  process.env.LFG_ANTIGRAVITY_PATH = FAKE_AGY;
  process.env.FAKE_AGY_LOG = logPath;
  done = null;
});

afterEach(async () => {
  if (done) {
    command({ type: "close" });
    await done;
  }
  process.chdir(originalCwd);
  resetTranscriptIndexConnectionForTests();
  PATHS.data = originalData;
  if (saved.path == null) delete process.env.LFG_ANTIGRAVITY_PATH;
  else process.env.LFG_ANTIGRAVITY_PATH = saved.path;
  if (saved.log == null) delete process.env.FAKE_AGY_LOG;
  else process.env.FAKE_AGY_LOG = saved.log;
  rmSync(root, { recursive: true, force: true });
});

describe("managed Antigravity session when agy ends between turns", () => {
  test("restarts agy and resumes the same conversation on the next message", async () => {
    start("high");
    await waitForPrompt();
    const oldPid = logged()[0]!.pid;
    await waitForText(`reply from ${oldPid}`);

    // What `pkill -f "agy acp"` did to idle sessions on 2026-11-18.
    await killAgy(oldPid);
    command({ type: "send", text: "still there?" });

    await waitForText(managedRestartResumedNotice("antigravity"));
    const after = logged().filter((entry) => entry.pid !== oldPid);
    const newPid = after[0]!.pid;
    await waitForText(`reply from ${newPid}`);

    // The new agy resumed the conversation by id instead of starting a new one.
    expect(after.map((entry) => entry.method)).toEqual([
      "initialize",
      "session/resume",
      "session/set_config_option",
      "session/prompt",
    ]);
    expect(after[1]!.params?.sessionId).toBe("fake-conversation");
    expect(after[2]!.params).toMatchObject({ configId: "thinking", value: "high" });
    expect(after[3]!.params?.sessionId).toBe("fake-conversation");
    expect((await texts()).some((text) => text.includes("turn failed"))).toBe(false);
  });

  test("a thinking level chosen while agy was gone applies on restart", async () => {
    start("medium");
    await waitForPrompt();
    const oldPid = logged()[0]!.pid;
    await waitForText(`reply from ${oldPid}`);
    await killAgy(oldPid);

    command({ type: "set_thinking_level", thinkingLevel: "low" });
    for (let i = 0; i < 100 && readEntry(KEY)?.thinkingLevel !== "low"; i++) await Bun.sleep(20);
    command({ type: "send", text: "go" });
    await waitForText(managedRestartResumedNotice("antigravity"));

    const set = logged().filter((entry) => entry.pid !== oldPid && entry.method === "session/set_config_option");
    expect(set.map((entry) => entry.params?.value)).toEqual(["low"]);
  });

  test("a live agy is reused, not restarted", async () => {
    start("medium");
    await waitForPrompt();
    const pid = logged()[0]!.pid;
    await waitForText(`reply from ${pid}`);
    command({ type: "send", text: "two" });
    for (let i = 0; i < 150 && logged().filter((entry) => entry.method === "session/prompt").length < 2; i++) {
      await Bun.sleep(20);
    }
    expect(new Set(logged().map((entry) => entry.pid)).size).toBe(1);
    expect(await texts()).not.toContain(managedRestartResumedNotice("antigravity"));
  });
});
