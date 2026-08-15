import { describe, expect, test } from "bun:test";
import {
  waitForHarnessExit,
  wakeHarnessCommandReader,
  type AisdkEntry,
} from "./aisdk-registry.ts";

function entry(commandWakeSignal?: "SIGUSR1"): AisdkEntry {
  return {
    sessionId: "session",
    harnessPid: process.pid,
    tmuxName: "managed",
    cwd: "/tmp",
    model: "auto",
    busy: false,
    createdAt: Date.now(),
    commandWakeSignal,
  };
}

describe("managed harness command wake", () => {
  test("does not signal an older harness that did not advertise support", () => {
    expect(wakeHarnessCommandReader(entry())).toBe(false);
  });

  test("signals a compatible harness", async () => {
    const sent: Array<{ pid: number; signal: string }> = [];
    expect(wakeHarnessCommandReader(entry("SIGUSR1"), (pid, signal) => {
      sent.push({ pid, signal });
    })).toBe(true);
    expect(sent).toEqual([{ pid: process.pid, signal: "SIGUSR1" }]);
  });

  test("returns as soon as the process exits", async () => {
    let checks = 0;
    let sleeps = 0;
    const exited = await waitForHarnessExit(42, {
      timeoutMs: 300,
      pollMs: 10,
      isAlive: () => checks++ < 2,
      sleep: async () => {
        sleeps++;
      },
    });
    expect(exited).toBe(true);
    expect(sleeps).toBe(2);
  });

  test("keeps the old grace bound for a stuck process", async () => {
    let now = 0;
    const exited = await waitForHarnessExit(42, {
      timeoutMs: 30,
      pollMs: 10,
      isAlive: () => true,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
      now: () => now,
    });
    expect(exited).toBe(false);
    expect(now).toBe(30);
  });
});
