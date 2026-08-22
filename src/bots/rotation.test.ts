import { describe, expect, test } from "bun:test";
import type { Bot } from "./store.ts";
import {
  appendArchivedSession,
  botCompactionDecision,
  botConfigStatus,
  botRotationAdmission,
  buildHandoffCheckpoint,
  defaultBotCompactionSettings,
  extractCheckpointSections,
  formatHandoffCheckpoint,
  measuredContextPercent,
  migrateLegacyBotRotationState,
  queueBlocksBotRotation,
  redactForCheckpoint,
  rotationCompareAndSwap,
  rotationNoticeText,
  runtimeRotationCompareAndSwap,
  sessionBoundConfigChanged,
  sessionBoundConfigOf,
} from "./rotation.ts";

const bot = (patch: Partial<Bot> = {}): Bot => ({
  id: "bot_one",
  name: "Scout",
  persona: "Be concise",
  agent: "aisdk",
  enabled: true,
  createdAt: 1,
  ...patch,
});

describe("bot configuration revisions", () => {
  test("manual persona edits create an update without treating cosmetics as runtime config", () => {
    const before = bot({ shape: "circle", colorway: "warm" });
    expect(sessionBoundConfigChanged(
      sessionBoundConfigOf(before),
      sessionBoundConfigOf({ ...before, persona: "Use the new instructions" }),
    )).toBe(true);
    const cosmeticAfter: Bot = { ...before, shape: "hexagon", colorway: "forest" };
    expect(sessionBoundConfigChanged(
      sessionBoundConfigOf(before),
      sessionBoundConfigOf(cosmeticAfter),
    )).toBe(false);
    expect(botConfigStatus({ configRevision: 2, appliedConfigRevision: 1, rotationState: "idle" }))
      .toBe("update-available");
  });

  test("CAS makes duplicate clients idempotent and rejects an older unapplied revision", () => {
    expect(rotationCompareAndSwap({ configRevision: 2, appliedConfigRevision: 1 }, 2))
      .toEqual({ proceed: true });
    expect(rotationCompareAndSwap({ configRevision: 2, appliedConfigRevision: 2 }, 2))
      .toEqual({ proceed: false, outcome: "already-applied" });
    expect(rotationCompareAndSwap({ configRevision: 3, appliedConfigRevision: 1 }, 2))
      .toEqual({ proceed: false, outcome: "stale" });
  });

  test("runtime CAS makes a repeated manual restart a no-op", () => {
    expect(runtimeRotationCompareAndSwap({ sessionId: "runtime-old" }, "runtime-old"))
      .toEqual({ proceed: true });
    expect(runtimeRotationCompareAndSwap({ sessionId: "runtime-new" }, "runtime-old"))
      .toEqual({ proceed: false, outcome: "already-rotated" });
    expect(runtimeRotationCompareAndSwap({}, null)).toEqual({ proceed: true });
  });

  test("manual restart has a distinct continuity notice", () => {
    expect(rotationNoticeText("restart")).toContain("runtime restart");
    expect(rotationNoticeText("restart")).not.toBe(rotationNoticeText("config"));
    expect(rotationNoticeText("restart")).not.toBe(rotationNoticeText("compaction"));
  });

  test("manual restart state does not impersonate Apply changes in the editor", () => {
    expect(botConfigStatus({
      configRevision: 2,
      appliedConfigRevision: 2,
      rotationState: "failed",
      rotationReason: "restart",
    })).toBe("current");
    expect(botConfigStatus({
      configRevision: 3,
      appliedConfigRevision: 2,
      rotationState: "queued",
      rotationReason: "restart",
    })).toBe("update-available");
  });

  test("legacy pending refresh becomes one queued revision on the stable conversation", () => {
    const migrated = migrateLegacyBotRotationState(bot({
      sessionId: "legacy-session",
      runtimeRefreshPending: true,
    }), 42);
    expect(migrated).toMatchObject({
      conversationId: "legacy-session",
      runtimeRefreshPending: false,
      configRevision: 2,
      appliedConfigRevision: 1,
      rotationState: "queued",
      rotationReason: "config",
      rotationUpdatedAt: 42,
    });
    expect(migrateLegacyBotRotationState(migrated, 43)).toEqual(migrated);
  });
});

describe("safe rotation admission", () => {
  test("waits for a busy primary and active children, but ignores completed children", () => {
    expect(botRotationAdmission("bot_one", { sessionId: "old", busy: true }, []))
      .toEqual({ ready: false, blocked: "primary-busy", children: [] });
    expect(botRotationAdmission("bot_one", { sessionId: "old", busy: false }, [
      { sessionId: "child", botId: "bot_one", parentSessionId: "old", pid: 10 },
    ])).toEqual({ ready: false, blocked: "children-active", children: ["child"] });
    expect(botRotationAdmission("bot_one", { sessionId: "old", busy: false }, [
      { sessionId: "child", botId: "bot_one", parentSessionId: "old", pid: 0 },
    ])).toEqual({ ready: true });
  });

  test("queued messages block rotation until delivery preserves their order", () => {
    expect(queueBlocksBotRotation([{ status: "pending" }, { status: "delivered" }])).toBe(true);
    expect(queueBlocksBotRotation([{ status: "queued" }])).toBe(true);
    expect(queueBlocksBotRotation([{ status: "delivered" }, { status: "failed" }])).toBe(false);
  });
});

describe("manual restart lifecycle", () => {
  test("accepts a healthy idle primary", () => {
    expect(runtimeRotationCompareAndSwap({ sessionId: "runtime-live" }, "runtime-live"))
      .toEqual({ proceed: true });
    expect(botRotationAdmission("bot_one", { sessionId: "runtime-live", busy: false, pid: 10 }, []))
      .toEqual({ ready: true });
  });

  test("accepts a dead primary binding for clean relaunch", () => {
    expect(runtimeRotationCompareAndSwap({ sessionId: "runtime-dead" }, "runtime-dead"))
      .toEqual({ proceed: true });
    expect(botRotationAdmission("bot_one", undefined, [])).toEqual({ ready: true });
  });

  test("runs immediately even when the primary is busy or a child is live", () => {
    // A human reaches for Restart precisely when the busy signal has stopped
    // meaning progress, so waiting on it parks the escape hatch behind the
    // wedged turn it exists to clear.
    expect(botRotationAdmission("bot_one", { sessionId: "runtime-live", busy: true }, [], "restart"))
      .toEqual({ ready: true });
    expect(botRotationAdmission("bot_one", { sessionId: "runtime-live", busy: false }, [
      { sessionId: "child-live", botId: "bot_one", parentSessionId: "runtime-live", pid: 11 },
    ], "restart")).toEqual({ ready: true });
  });

  test("still defers a rotation the machine decided to run", () => {
    expect(botRotationAdmission("bot_one", { sessionId: "runtime-live", busy: true }, [], "config"))
      .toEqual({ ready: false, blocked: "primary-busy", children: [] });
    expect(botRotationAdmission("bot_one", { sessionId: "runtime-live", busy: true }, [], "compaction"))
      .toEqual({ ready: false, blocked: "primary-busy", children: [] });
    expect(botRotationAdmission("bot_one", { sessionId: "runtime-live", busy: false }, [
      { sessionId: "child-live", botId: "bot_one", parentSessionId: "runtime-live", pid: 11 },
    ], "compaction")).toEqual({ ready: false, blocked: "children-active", children: ["child-live"] });
  });
});

describe("automatic context rotation", () => {
  const settings = defaultBotCompactionSettings();

  test("uses measured token capacity and rotates at the exact threshold", () => {
    const usage = { available: true, context: { used: 78_000, max: 100_000, percent: 1 } };
    expect(measuredContextPercent(usage)).toBe(78);
    expect(botCompactionDecision({ usage, bot: {}, settings, now: 1_000 })).toMatchObject({
      rotate: true,
      armed: false,
      reason: "threshold-crossed",
    });
  });

  test("does not guess without token data and hysteresis prevents a loop", () => {
    expect(botCompactionDecision({ usage: null, bot: {}, settings, now: 1_000 }).reason)
      .toBe("no-token-data");
    expect(botCompactionDecision({
      usage: { context: { used: 90, max: 100 } },
      bot: { compactionArmed: false },
      settings,
      now: 2_000,
    }).reason).toBe("not-armed");
    expect(botCompactionDecision({
      usage: { context: { used: 50, max: 100 } },
      bot: { compactionArmed: false },
      settings,
      now: 3_000,
    })).toMatchObject({ rotate: false, armed: true });
  });

  test("minimum interval rejects another automatic rotation", () => {
    const result = botCompactionDecision({
      usage: { context: { used: 90, max: 100 } },
      bot: { compactionArmed: true, lastCompactionAt: 10_000 },
      settings,
      now: 10_000 + settings.minIntervalMs - 1,
    });
    expect(result.reason).toBe("too-soon");
  });
});

describe("continuity checkpoint", () => {
  test("extracts goals and only explicit durable sections", () => {
    expect(extractCheckpointSections([
      { role: "user", text: "Please finish the runtime rotation." },
      { role: "assistant", text: "Decision: keep one durable conversation id.\nRemaining: run browser acceptance." },
      { role: "user", text: "I prefer short progress updates." },
    ])).toEqual({
      goals: ["Please finish the runtime rotation.", "I prefer short progress updates."],
      decisions: ["Decision: keep one durable conversation id."],
      openTasks: ["Remaining: run browser acceptance."],
      preferences: ["I prefer short progress updates."],
    });
  });

  test("keeps verified and legacy authors while removing old contracts and secrets", () => {
    const checkpoint = buildHandoffCheckpoint({
      sourceSessionId: "old-runtime",
      reason: "config",
      configRevision: 4,
      createdAt: 100,
      goals: ["Ship the rotation"],
      decisions: ["Keep conversation identity stable"],
      openTasks: ["Run acceptance"],
      preferences: ["Use short updates"],
      artifacts: ["ff64f2b"],
      turns: [
        { role: "user", author: "person@example.com", text: "Continue from ff64f2b" },
        { role: "user", author: "legacy:unknown", text: "Historical request" },
        { role: "assistant", text: "Token: sk-abcdefghijklmnopqrstuvwxyz" },
      ],
    });
    const rendered = formatHandoffCheckpoint(checkpoint);
    expect(rendered).toContain("Source session: old-runtime");
    expect(rendered).toContain("user (person@example.com)");
    expect(rendered).toContain("user (legacy:unknown)");
    expect(rendered).toContain("[redacted]");
    expect(rendered).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });

  test("does not carry a prior runtime contract into the new prompt", () => {
    const old = "=== omg.dev BOT RUNTIME CONTRACT ===\nold persona\n=== END omg.dev BOT RUNTIME CONTRACT ===\nreal turn";
    expect(redactForCheckpoint(old)).toBe("real turn");
  });

  test("archives runtimes once and keeps the list bounded", () => {
    const history = Array.from({ length: 30 }, (_, index) => `s${index}`);
    const archived = appendArchivedSession(history, "s5");
    expect(archived[0]).toBe("s5");
    expect(archived.filter((id) => id === "s5")).toHaveLength(1);
    expect(archived).toHaveLength(25);
  });
});
