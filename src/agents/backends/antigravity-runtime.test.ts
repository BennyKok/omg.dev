import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANTIGRAVITY_RESTARTED_NOTICE, createAntigravityRuntime } from "./antigravity-acp-session.ts";
import type { ManagedSdkEventSink, ManagedSdkRuntime } from "./managed-sdk-session.ts";

const FAKE_AGY = join(import.meta.dir, "fixtures", "fake-agy-acp.ts");

type Logged = { pid: number; method: string; params?: Record<string, unknown> };

let dir: string;
let logPath: string;
let runtime: ManagedSdkRuntime | null;
let notices: string[];
const saved = { path: process.env.LFG_ANTIGRAVITY_PATH, log: process.env.FAKE_AGY_LOG };

function sink(): ManagedSdkEventSink {
  return {
    draft() {},
    commitText() {},
    thinking() {},
    notice: (text) => notices.push(text),
    toolStart() {},
    toolEnd() {},
    ask: async () => null,
  };
}

function logged(): Logged[] {
  return readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agy-runtime-"));
  logPath = join(dir, "agy.log");
  process.env.LFG_ANTIGRAVITY_PATH = FAKE_AGY;
  process.env.FAKE_AGY_LOG = logPath;
  notices = [];
  runtime = null;
});

afterEach(async () => {
  await runtime?.close();
  if (saved.path == null) delete process.env.LFG_ANTIGRAVITY_PATH;
  else process.env.LFG_ANTIGRAVITY_PATH = saved.path;
  if (saved.log == null) delete process.env.FAKE_AGY_LOG;
  else process.env.FAKE_AGY_LOG = saved.log;
  rmSync(dir, { recursive: true, force: true });
});

describe("Antigravity runtime when agy ends between turns", () => {
  test("restarts agy and resumes the same conversation on the next turn", async () => {
    runtime = await createAntigravityRuntime(
      { key: "test-key", cwd: dir, model: "default", thinkingLevel: "high", recordLevels: async () => {} },
      sink(),
    );
    expect(runtime.nativeSessionId).toBe("fake-conversation");

    const first = await runtime.runTurn("hello", sink());
    const firstPid = logged()[0]!.pid;
    expect(first.text).toBe(`reply from ${firstPid}`);

    // What `pkill -f "agy acp"` did to idle sessions on 2026-11-18.
    await killAgy(firstPid);

    const second = await runtime.runTurn("still there?", sink());
    const after = logged().filter((entry) => entry.pid !== firstPid);
    const secondPid = after[0]!.pid;
    expect(secondPid).not.toBe(firstPid);
    expect(second.text).toBe(`reply from ${secondPid}`);

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
    expect(notices).toEqual([ANTIGRAVITY_RESTARTED_NOTICE]);
  });

  test("a thinking level chosen while agy was gone applies on restart", async () => {
    runtime = await createAntigravityRuntime(
      { key: "test-key", cwd: dir, model: "default", thinkingLevel: "medium", recordLevels: async () => {} },
      sink(),
    );
    const firstPid = logged()[0]!.pid;
    await killAgy(firstPid);

    await runtime.setThinkingLevel?.("low");
    await runtime.runTurn("go", sink());

    const set = logged().filter((entry) => entry.pid !== firstPid && entry.method === "session/set_config_option");
    expect(set.map((entry) => entry.params?.value)).toEqual(["low"]);
  });

  test("a live agy is reused, not restarted", async () => {
    runtime = await createAntigravityRuntime(
      { key: "test-key", cwd: dir, model: "default", recordLevels: async () => {} },
      sink(),
    );
    await runtime.runTurn("one", sink());
    await runtime.runTurn("two", sink());
    expect(new Set(logged().map((entry) => entry.pid)).size).toBe(1);
    expect(notices).toEqual([]);
  });
});
