// The one reclaim path with no human in the loop, so the policy is pinned
// hard. Every exclusion below is a way this could destroy or interrupt work
// if it drifted.
import { describe, expect, test } from "bun:test";

import { memoryReclaimCandidates } from "./idle-archive.ts";

const NOW = 1_000_000_000;
const HOUR = 60 * 60_000;

describe("memory reclaim policy", () => {
  function durable(over: Record<string, unknown> = {}) {
    return {
      sessionId: "s1",
      managed: true,
      busy: false,
      launching: false,
      agent: "aisdk",
      runtime: "command-file" as const,
      lastActivityAt: NOW - 8 * HOUR,
      startedAt: NOW - 9 * HOUR,
      ...over,
    };
  }

  test("reclaims an idle durable harness", () => {
    expect(memoryReclaimCandidates([durable()])).toHaveLength(1);
  });

  // The bug this exists to pin: a bot is idle between turns by definition, so
  // it sorted to the front of this list and any unrelated launch could
  // reclaim it. A bot relaunch mints a new session id, so the human's chat
  // history with that bot came back empty.
  test("never reclaims a persistent session, however idle", () => {
    const bot = durable({ sessionId: "bot", persistent: true, lastActivityAt: NOW - 100 * HOUR });
    expect(memoryReclaimCandidates([bot])).toEqual([]);
    expect(memoryReclaimCandidates([bot, durable({ sessionId: "task" })]).map((s) => s.sessionId))
      .toEqual(["task"]);
  });

  test("leaves busy, launching, unmanaged and id-less sessions alone", () => {
    expect(memoryReclaimCandidates([durable({ busy: true })])).toEqual([]);
    expect(memoryReclaimCandidates([durable({ launching: true })])).toEqual([]);
    expect(memoryReclaimCandidates([durable({ managed: false })])).toEqual([]);
    expect(memoryReclaimCandidates([durable({ sessionId: null })])).toEqual([]);
  });

  test("leaves process-bound harnesses alone — reclaiming one is a kill, not an archive", () => {
    expect(memoryReclaimCandidates([durable({ agent: "jcode", runtime: "tmux" })])).toEqual([]);
  });

  test("takes the longest-idle first", () => {
    const picked = memoryReclaimCandidates([
      durable({ sessionId: "a", lastActivityAt: NOW - 5 * HOUR }),
      durable({ sessionId: "b", lastActivityAt: NOW - 30 * HOUR }),
      durable({ sessionId: "c", lastActivityAt: NOW - 12 * HOUR }),
    ]);
    expect(picked.map((s) => s.sessionId)).toEqual(["b", "c", "a"]);
  });
});
