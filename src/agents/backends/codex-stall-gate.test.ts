import { describe, expect, test } from "bun:test";
import { CodexStallError, createStallGate } from "./codex-aisdk-session.ts";
import {
  AISDK_STREAM_STALL_MS,
  AISDK_STREAM_WATCHDOG_TICK_MS,
  isAisdkStreamStalled,
} from "./aisdk-session.ts";

// A promise that models the actual failure: the Codex async iterator that
// neither yields nor rejects, forever.
const never = <T>() => new Promise<T>(() => {});

describe("codex stall gate", () => {
  test("interrupts a wait that never settles on its own", async () => {
    const gate = createStallGate();
    const wait = gate.race(never<string>());
    gate.trip(new CodexStallError("stalled"));
    await expect(wait).rejects.toThrow(CodexStallError);
  });

  test("passes a normal result straight through and disarms", async () => {
    const gate = createStallGate();
    expect(gate.armed).toBe(false);
    const wait = gate.race(Promise.resolve("event"));
    expect(gate.armed).toBe(true);
    expect(await wait).toBe("event");
    expect(gate.armed).toBe(false);
  });

  test("a real stream error is preserved, not masked by the gate", async () => {
    const gate = createStallGate();
    const wait = gate.race(Promise.reject(new Error("turn failed")));
    await expect(wait).rejects.toThrow("turn failed");
  });

  // The watchdog fires on a timer, so it routinely ticks while the harness sits
  // idle between turns. That must not throw or leave the gate armed.
  test("tripping while idle is a no-op", async () => {
    const gate = createStallGate();
    expect(() => gate.trip(new CodexStallError("nothing in flight"))).not.toThrow();
    expect(gate.armed).toBe(false);
    expect(await gate.race(Promise.resolve("still works"))).toBe("still works");
  });

  test("tripping after the wait already settled does not affect it", async () => {
    const gate = createStallGate();
    expect(await gate.race(Promise.resolve("done"))).toBe("done");
    expect(() => gate.trip(new CodexStallError("late"))).not.toThrow();
  });

  test("each turn re-arms the gate", async () => {
    const gate = createStallGate();
    expect(await gate.race(Promise.resolve(1))).toBe(1);
    const second = gate.race(never<number>());
    gate.trip(new CodexStallError("second turn stalled"));
    await expect(second).rejects.toThrow(CodexStallError);
  });
});

describe("codex reuses the shared stall bound", () => {
  // The point of importing the Claude harness's predicate rather than writing a
  // second one: both harnesses answer "is this stream stalled" identically.
  test("an idle session never trips, however long it sits", () => {
    expect(isAisdkStreamStalled({
      busy: false,
      closing: false,
      restartRequested: false,
      lastSdkEventAt: 0,
      now: AISDK_STREAM_STALL_MS * 10,
    })).toBe(false);
  });

  test("a silent active turn trips at the shared bound", () => {
    expect(isAisdkStreamStalled({
      busy: true,
      closing: false,
      restartRequested: false,
      lastSdkEventAt: 0,
      now: AISDK_STREAM_STALL_MS,
    })).toBe(true);
  });

  test("the watchdog ticks strictly faster than the bound it checks", () => {
    expect(AISDK_STREAM_WATCHDOG_TICK_MS).toBeLessThan(AISDK_STREAM_STALL_MS);
  });
});
