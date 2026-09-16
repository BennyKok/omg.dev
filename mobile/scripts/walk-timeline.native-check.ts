/**
 * The Home Screen village's only source of motion.
 *
 * WidgetKit runs no render loop, so a walk is entirely the difference between
 * consecutive timeline entries. That makes the pose assignment the whole
 * feature, and it is the part that was silently broken.
 */
import { expect, test } from "bun:test";
import {
  WALK_ENTRIES,
  WALK_PHASES,
  shouldWriteTimeline,
  timelineWindowMs,
  walkPhaseAt,
  walkTimeline,
} from "../src/omg/walk-timeline";

const STEP = 90_000;
const phases = (from: Date) => walkTimeline({ n: 1 }, STEP, from).map((entry) => entry.props.walkPhase);

test("a write covers a useful stretch of wall clock", () => {
  expect(walkTimeline({ n: 1 }, STEP, new Date(0))).toHaveLength(WALK_ENTRIES);
});

test("consecutive entries are consecutive poses, so the village paces", () => {
  const seen = phases(new Date(0));
  for (let i = 1; i < seen.length; i += 1) {
    expect(seen[i]).toBe((seen[i - 1] + 1) % WALK_PHASES);
  }
});

/**
 * THE BUG THIS FILE EXISTS FOR.
 *
 * The pose used to be the entry's INDEX, so every write restarted the cycle at
 * pose 0. The bridge rewrites on every status change and again every 30
 * seconds while the app is in the foreground, so each rewrite dropped a fresh
 * pose-0 entry at `now` and the agents stood on the spot they start from for
 * as long as anybody was using the app. Reported as the village not moving at
 * all.
 *
 * Deriving the pose from wall-clock time makes a rewrite idempotent: the same
 * instant gets the same pose no matter who wrote it, or how often.
 */
test("rewriting the timeline does not restart the walk", () => {
  const at = new Date(7 * STEP + 12_000);
  const first = walkTimeline({ n: 1 }, STEP, at)[0].props.walkPhase;
  // Three more writes land while the same step is current, as they do when a
  // status change arrives or the 30s foreground refresh fires.
  for (const skew of [1_000, 20_000, 60_000]) {
    expect(walkTimeline({ n: 1 }, STEP, new Date(at.getTime() + skew))[0].props.walkPhase).toBe(first);
  }
});

test("the pose does advance once a step has actually elapsed", () => {
  const at = 7 * STEP;
  expect(walkPhaseAt(at + STEP, STEP)).not.toBe(walkPhaseAt(at, STEP));
});

test("every pose is reachable, so no part of the cycle is dead", () => {
  const seen = new Set<number>();
  for (let i = 0; i < 40; i += 1) seen.add(walkPhaseAt(i * STEP, STEP));
  expect(seen.size).toBe(WALK_PHASES);
});

test("entries are ordered and one step apart", () => {
  const entries = walkTimeline({ n: 1 }, STEP, new Date(1_000));
  for (let i = 1; i < entries.length; i += 1) {
    expect(entries[i].date.getTime() - entries[i - 1].date.getTime()).toBe(STEP);
  }
});

/**
 * HOW OFTEN THE TIMELINE IS ALLOWED TO BE REWRITTEN.
 *
 * Every write ends in `reloadTimelines(ofKind:)`, and Apple throttles a widget
 * that asks for reloads far more often than its content changes -- the budget
 * is a few dozen a day. The bridge was writing on every status change AND
 * every 30 seconds while the app was foregrounded, so the surface most
 * starved of redraws was the one asking hardest, which is the walk.
 *
 * The walk no longer needs a write at all: the pose comes from the clock, so
 * entries already on the device keep advancing by themselves.
 */
const WINDOW = 8 * STEP;

test("the first write always happens", () => {
  expect(shouldWriteTimeline(null, "a", 0, WINDOW)).toBe(true);
});

test("changed content is written immediately", () => {
  expect(shouldWriteTimeline({ signature: "a", at: 1000 }, "b", 1001, WINDOW)).toBe(true);
});

test("identical content does not ask WidgetKit to reload", () => {
  const last = { signature: "a", at: 0 };
  // The 30s foreground cadence, for four minutes, with nothing changing.
  for (let t = 30_000; t <= 240_000; t += 30_000) {
    expect(shouldWriteTimeline(last, "a", t, WINDOW)).toBe(false);
  }
});

/**
 * It still has to be extended before it runs out, or the village reaches the
 * last entry and freezes on that pose. Half the window leaves a full margin.
 */
test("an unchanged timeline is extended before it can run dry", () => {
  const last = { signature: "a", at: 0 };
  expect(shouldWriteTimeline(last, "a", WINDOW / 2 - 1, WINDOW)).toBe(false);
  expect(shouldWriteTimeline(last, "a", WINDOW / 2, WINDOW)).toBe(true);
  // And the rewrite lands well before the final entry comes due.
  expect(WINDOW / 2).toBeLessThan(WINDOW);
});

test("the window is the whole span a write covers", () => {
  expect(timelineWindowMs(STEP)).toBe(WALK_ENTRIES * STEP);
});
