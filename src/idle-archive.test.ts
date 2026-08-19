// Archiving on a timer is the one reclaim path with no human in the loop, so
// the policy is pinned hard. Every exclusion below is a way this could destroy
// or interrupt work if it drifted.
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_IDLE_ARCHIVE_MINUTES,
  MIN_IDLE_ARCHIVE_MINUTES,
  idleArchiveCandidates,
  idleMsFor,
  memoryReclaimCandidates,
  sanitizeIdleArchiveMinutes,
} from "./idle-archive.ts";

const NOW = 1_000_000_000;
const HOUR = 60 * 60_000;

function session(over: Partial<Parameters<typeof idleArchiveCandidates>[0][number]> = {}) {
  return {
    sessionId: "s1",
    managed: true,
    busy: false,
    launching: false,
    lastActivityAt: NOW - 8 * HOUR,
    startedAt: NOW - 9 * HOUR,
    ...over,
  };
}

const FOUR_HOURS = { now: NOW, idleMs: 4 * HOUR };

describe("idle archive policy", () => {
  test("archives a session idle past the window", () => {
    expect(idleArchiveCandidates([session()], FOUR_HOURS)).toHaveLength(1);
  });

  test("leaves a session that is still within the window", () => {
    const recent = session({ lastActivityAt: NOW - 1 * HOUR });
    expect(idleArchiveCandidates([recent], FOUR_HOURS)).toEqual([]);
  });

  test("never archives a session with a turn in flight", () => {
    // Idle for a week, but working right now: archiving discards the turn.
    const working = session({ busy: true, lastActivityAt: NOW - 7 * 24 * HOUR });
    expect(idleArchiveCandidates([working], FOUR_HOURS)).toEqual([]);
  });

  test("never archives a session that is still starting up", () => {
    // A launching session has no meaningful activity clock yet; archiving it
    // would punish it for being new.
    const launching = session({ launching: true, lastActivityAt: null, startedAt: NOW - 9 * HOUR });
    expect(idleArchiveCandidates([launching], FOUR_HOURS)).toEqual([]);
  });

  test("never archives a persistent bot session", () => {
    expect(idleArchiveCandidates([session({ persistent: true })], FOUR_HOURS)).toEqual([]);
  });

  test("never archives an unmanaged session", () => {
    // A human's own tmux session is not ours to close.
    expect(idleArchiveCandidates([session({ managed: false })], FOUR_HOURS)).toEqual([]);
  });

  test("never archives a session with no id to resume from", () => {
    // Without a session id there is no resume record, so "archive" would just
    // be "kill" — the one thing this must never silently do.
    expect(idleArchiveCandidates([session({ sessionId: null })], FOUR_HOURS)).toEqual([]);
  });

  test("never archives when idle time cannot be established", () => {
    const unknown = session({ lastActivityAt: null, startedAt: null });
    expect(idleArchiveCandidates([unknown], FOUR_HOURS)).toEqual([]);
  });

  test("falls back to start time for a session that never produced a turn", () => {
    const silent = session({ lastActivityAt: null, startedAt: NOW - 6 * HOUR });
    expect(idleMsFor(silent, NOW)).toBe(6 * HOUR);
    expect(idleArchiveCandidates([silent], FOUR_HOURS)).toHaveLength(1);
  });

  test("a zero window disables archiving entirely", () => {
    // The off switch has to be absolute: no window means no timer-driven close.
    expect(idleArchiveCandidates([session()], { now: NOW, idleMs: 0 })).toEqual([]);
  });

  test("archives the longest-idle first and caps the batch", () => {
    const sessions = [
      session({ sessionId: "a", lastActivityAt: NOW - 5 * HOUR }),
      session({ sessionId: "b", lastActivityAt: NOW - 30 * HOUR }),
      session({ sessionId: "c", lastActivityAt: NOW - 12 * HOUR }),
    ];
    const picked = idleArchiveCandidates(sessions, { ...FOUR_HOURS, limit: 2 });
    expect(picked.map((s) => s.sessionId)).toEqual(["b", "c"]);
  });

  test("is off by default", () => {
    expect(DEFAULT_IDLE_ARCHIVE_MINUTES).toBe(0);
    expect(sanitizeIdleArchiveMinutes(undefined)).toBe(0);
    expect(sanitizeIdleArchiveMinutes(0)).toBe(0);
  });

  test("clamps a window too short to be safe", () => {
    // A 1-minute window would archive an agent pausing between turns.
    expect(sanitizeIdleArchiveMinutes(1)).toBe(MIN_IDLE_ARCHIVE_MINUTES);
    expect(sanitizeIdleArchiveMinutes(-5)).toBe(0);
    expect(sanitizeIdleArchiveMinutes("abc")).toBe(0);
    expect(sanitizeIdleArchiveMinutes(999_999)).toBe(7 * 24 * 60);
  });
});

// The second reaper. It runs on memory pressure rather than on a timer, so it
// fires under exactly the conditions where a wrong choice is least visible.
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

  // The bug this exists to pin: a bot is idle between turns by definition, so it
  // sorted to the front of this list and any unrelated launch could reclaim it —
  // while idleArchiveCandidates exempted it. Archiving is normally cheap because
  // a session resumes; a bot relaunch mints a new session id, so the human's
  // chat history with that bot came back empty.
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
