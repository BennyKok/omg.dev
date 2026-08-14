import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCmd, readEntry } from "../../aisdk-registry.ts";
import { PATHS } from "../../config.ts";
import { resetTranscriptIndexConnectionForTests } from "../../transcript-index.ts";
import { runManagedSdkSession } from "./managed-sdk-session.ts";

const originalData = PATHS.data;
const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lfg-managed-sdk-"));
  PATHS.data = join(root, "data");
  resetTranscriptIndexConnectionForTests();
});

afterEach(() => {
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
    appendCmd(KEY, { type: "close" });
    await done;
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
