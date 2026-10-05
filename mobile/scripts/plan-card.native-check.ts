/**
 * The Settings plan meters. Cases and strings mirror the dashboard's
 * apps/web/tests/plan-card.test.ts (vibes), so the two cards say the same thing.
 */
import { expect, test } from "bun:test";

import { formatResetDate, parseAgentCount, parseBuildUsage, planCardModel } from "../src/omg/plan-card";

const NOW = Date.UTC(2026, 9, 4, 12);
const NOV_1 = Date.UTC(2026, 10, 1, 12);
const build = (remainingUsd: number, limitUsd = 38) => ({ limitUsd, remainingUsd, resetsAt: NOV_1 });

test("credit shows the share used and the reset date", () => {
  const { credit } = planCardModel({ build: build(34.39), agents: null, now: NOW });
  expect(credit).toEqual({
    used: "9% AI credit used",
    resets: `Resets ${formatResetDate(NOV_1, NOW)}`,
    usedPercent: 9,
    low: false,
  });
});

test("credit under a quarter left is low", () => {
  expect(planCardModel({ build: build(9), agents: null, now: NOW }).credit?.low).toBe(true);
  expect(planCardModel({ build: build(9.5), agents: null, now: NOW }).credit?.low).toBe(false);
});

test("a plan with no allowance has no credit meter", () => {
  expect(planCardModel({ build: build(0, 0), agents: null, now: NOW }).credit).toBeNull();
  expect(planCardModel({ build: null, agents: null, now: NOW })).toEqual({ agents: null, credit: null });
});

test("credit never reads negative or above the allowance", () => {
  expect(planCardModel({ build: build(-3), agents: null, now: NOW }).credit).toMatchObject({ usedPercent: 100, low: true });
  expect(planCardModel({ build: build(50), agents: null, now: NOW }).credit?.usedPercent).toBe(0);
});

test("a past reset reads as now", () => {
  const credit = planCardModel({ build: { limitUsd: 38, remainingUsd: 30, resetsAt: NOW - 1 }, agents: null, now: NOW }).credit;
  expect(credit?.resets).toBe("Resets now");
});

test("the agents meter counts live agents against the plan limit", () => {
  const agents = (active: number | null, limit: number) => planCardModel({ build: null, agents: { active, limit }, now: NOW }).agents;
  expect(agents(2, 5)).toEqual({ label: "2 of 5 agents running", usedPercent: 40, full: false });
  expect(agents(5, 5)).toMatchObject({ usedPercent: 100, full: true });
  expect(agents(7, 5)).toMatchObject({ usedPercent: 100, full: true });
  // Asleep: only the limit is known, so the bar stays empty.
  expect(agents(null, 16)).toEqual({ label: "Up to 16 agents at once", usedPercent: 0, full: false });
  expect(agents(1, 1)?.label).toBe("1 of 1 agent running");
  expect(agents(0, 0)).toBeNull();
});

test("no state puts a dollar amount on the card", () => {
  for (const b of [build(34.39), build(7), build(80, 98), null]) {
    const card = planCardModel({ build: b, agents: { active: 1, limit: 5 }, now: NOW });
    expect(JSON.stringify(card)).not.toContain("$");
  }
});

test("replies are parsed defensively", () => {
  expect(parseBuildUsage({ build: { limitUsd: 38, remainingUsd: 30, resetsAt: NOV_1, usedUsd: 8 } })).toEqual(build(30));
  expect(parseBuildUsage({ build: null })).toBeNull();
  expect(parseBuildUsage({ build: { limitUsd: "38", remainingUsd: 30, resetsAt: NOV_1 } })).toBeNull();
  expect(parseBuildUsage(null)).toBeNull();
  expect(parseAgentCount({ active: 2, limit: 5 })).toEqual({ active: 2, limit: 5 });
  expect(parseAgentCount({ active: null, limit: 5 })).toEqual({ active: null, limit: 5 });
  expect(parseAgentCount(null)).toBeNull();
  expect(parseAgentCount({ active: 1 })).toBeNull();
});
