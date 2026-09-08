import { describe, expect, test } from "bun:test";
import { waitForRefine, type AutoAgentRefine } from "./auto-refine";

function script(states: (AutoAgentRefine | undefined | Error)[]) {
  let i = 0;
  const calls: number[] = [];
  return {
    calls,
    fetchStatus: async () => {
      calls.push(i);
      const s = states[Math.min(i++, states.length - 1)];
      if (s instanceof Error) throw s;
      return s;
    },
  };
}

const noSleep = async () => {};

describe("waitForRefine", () => {
  test("resolves once the server reports the rewrite done", async () => {
    const s = script([
      { state: "running", startedAt: 1 },
      { state: "running", startedAt: 1 },
      { state: "done", at: 2 },
    ]);
    await waitForRefine(s.fetchStatus, { sleep: noSleep });
    expect(s.calls.length).toBe(3);
  });

  test("surfaces the server's error when the rewrite failed", async () => {
    const s = script([{ state: "running", startedAt: 1 }, { state: "failed", at: 2, error: "refiner produced no output" }]);
    await expect(waitForRefine(s.fetchStatus, { sleep: noSleep })).rejects.toThrow("refiner produced no output");
  });

  test("a vanished state (serve restarted) is reported, not spun on", async () => {
    const s = script([{ state: "running", startedAt: 1 }, undefined]);
    await expect(waitForRefine(s.fetchStatus, { sleep: noSleep })).rejects.toThrow(/restarted/);
  });

  test("rides out a few failed polls (phone coming back from the lock screen)", async () => {
    const s = script([
      { state: "running", startedAt: 1 },
      new Error("Load failed"),
      new Error("Load failed"),
      { state: "done", at: 2 },
    ]);
    await waitForRefine(s.fetchStatus, { sleep: noSleep, retries: 2 });
    expect(s.calls.length).toBe(4);
  });

  test("gives up after too many consecutive failed polls", async () => {
    const s = script([new Error("Load failed")]);
    await expect(waitForRefine(s.fetchStatus, { sleep: noSleep, retries: 2 })).rejects.toThrow("Load failed");
    expect(s.calls.length).toBe(3);
  });

  test("stops waiting after the timeout while still running", async () => {
    let t = 0;
    const s = script([{ state: "running", startedAt: 1 }]);
    await expect(
      waitForRefine(s.fetchStatus, {
        sleep: async () => {
          t += 1000;
        },
        now: () => t,
        timeoutMs: 2500,
      }),
    ).rejects.toThrow(/still updating/);
  });
});
