// Per-session routes read one row from the cached list and scan only on a miss.
import { describe, expect, test } from "bun:test";
import { findListedSession } from "./session-cache.ts";
import type { Session } from "./sessions.ts";

const row = (sessionId: string) => ({ sessionId, cwd: `/work/${sessionId}` }) as Session;

describe("findListedSession", () => {
  test("answers from the cached list without a fresh scan", async () => {
    let scans = 0;
    const found = await findListedSession((s) => s.sessionId === "a", {
      cached: async () => [row("a"), row("b")],
      fresh: async () => { scans++; return []; },
    });
    expect(found?.cwd).toBe("/work/a");
    expect(scans).toBe(0);
  });

  test("scans when the cache does not hold the session yet", async () => {
    let scans = 0;
    const found = await findListedSession((s) => s.sessionId === "new", {
      cached: async () => [row("a")],
      fresh: async () => { scans++; return [row("a"), row("new")]; },
    });
    expect(found?.sessionId).toBe("new");
    expect(scans).toBe(1);
  });

  test("a failed cache read falls back to the scan", async () => {
    const found = await findListedSession((s) => s.sessionId === "a", {
      cached: async () => { throw new Error("busy"); },
      fresh: async () => [row("a")],
    });
    expect(found?.sessionId).toBe("a");
  });

  test("a session in neither list is not found", async () => {
    const found = await findListedSession((s) => s.sessionId === "gone", {
      cached: async () => [],
      fresh: async () => [],
    });
    expect(found).toBeUndefined();
  });
});
