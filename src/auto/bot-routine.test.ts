// Pure helpers a fired bot-owned routine relies on: the attributed nudge text
// (docs/bot-owned-automations-plan.md §2c) and the minimum-interval floor
// (§3f) that is the second layer of "runaway self-scheduling" defense, after
// the per-bot cap.
import { describe, expect, test } from "bun:test";
import { exceedsMaxFrequency, routineNudgeText } from "./bot-routine.ts";
import type { AutoAgent } from "./store.ts";

function agent(overrides: Partial<AutoAgent> = {}): AutoAgent {
  return {
    id: "check-inbox",
    name: "Check inbox",
    prompt: "Look for anything urgent and summarize it.",
    schedule: "0 9 * * *",
    enabled: true,
    owner: { kind: "bot", botId: "bot_abc" },
    ...overrides,
  };
}

describe("routineNudgeText", () => {
  test("is visually distinct from a human message and carries the routine's name and prompt", () => {
    const text = routineNudgeText(agent());
    expect(text).toStartWith("[Scheduled routine: Check inbox]");
    expect(text).toContain("Look for anything urgent and summarize it.");
  });

  test("does not silently drop the prompt for an unusual name", () => {
    const text = routineNudgeText(agent({ name: "Weird ] name [ with brackets" }));
    expect(text).toContain("Weird ] name [ with brackets");
    expect(text.endsWith(agent().prompt)).toBe(true);
  });
});

describe("exceedsMaxFrequency — the minimum-interval floor", () => {
  test("a once-daily schedule is nowhere near the ceiling", () => {
    expect(exceedsMaxFrequency("0 9 * * *", "UTC")).toBe(false);
  });

  test("an hourly schedule (24/day) is under the default 48/day ceiling", () => {
    expect(exceedsMaxFrequency("0 * * * *", "UTC")).toBe(false);
  });

  test("every-30-minutes (48/day) sits exactly at the default ceiling and is not rejected", () => {
    expect(exceedsMaxFrequency("*/30 * * * *", "UTC")).toBe(false);
  });

  test("every-20-minutes (72/day) crosses the default ceiling", () => {
    expect(exceedsMaxFrequency("*/20 * * * *", "UTC")).toBe(true);
  });

  test("every minute is rejected outright", () => {
    expect(exceedsMaxFrequency("* * * * *", "UTC")).toBe(true);
  });

  test("a custom, lower ceiling is honored", () => {
    expect(exceedsMaxFrequency("0 * * * *", "UTC", 12)).toBe(true); // 24/day > 12
    expect(exceedsMaxFrequency("0 */3 * * *", "UTC", 12)).toBe(false); // 8/day <= 12
  });

  test("stops scanning early rather than walking the full 24h window once it's over the limit", () => {
    // A regression here would still return the right boolean but re-introduce
    // an O(24h) scan on every save of a bot-owned routine; this just pins the
    // observable contract (true/false), the early-return is covered by not
    // timing out on CI even for a maximally-frequent schedule.
    const start = performance.now();
    expect(exceedsMaxFrequency("* * * * *", "UTC")).toBe(true);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
