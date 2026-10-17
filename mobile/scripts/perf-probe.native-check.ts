import { expect, test } from "bun:test";
import { ACTIVE_MS, FrameStats, PerfProbe, perfLines } from "../src/omg/perf-probe";

test("frame stats count thresholds exactly and bound the quantiles", () => {
  const stats = new FrameStats();
  for (let i = 0; i < 95; i += 1) stats.add(16.7);
  for (const ms of [26, 30, 51, 80, 140]) stats.add(ms);
  const s = stats.summary();
  expect(s).toMatchObject({ count: 100, over25: 5, over50: 3, max: 140 });
  expect(s.p50).toBe(20); // the upper edge of the 16-20ms bin
  expect(s.p95).toBeGreaterThanOrEqual(16.7);
  expect(s.p95).toBeLessThanOrEqual(20);
});

test("JS frames count only while the list is moving", () => {
  let now = 0;
  const queued: Array<() => void> = [];
  const probe = new PerfProbe(() => now, (cb) => { queued.push(cb); return queued.length; }, () => {});
  const states: boolean[] = [];
  probe.onActive((active) => states.push(active));
  probe.reset();
  const step = (ms: number) => { now += ms; const cb = queued.shift(); cb?.(); };
  probe.activity();
  step(16);
  step(16);
  step(60);
  // A frame that began while moving and ran past the window is a real hitch:
  // it counts, and it ends the run. The first frame only starts the clock.
  step(ACTIVE_MS + 10);
  expect(probe.js.summary()).toMatchObject({ count: 3, over50: 2, max: ACTIVE_MS + 10 });
  expect(states).toEqual([false, true, false]);
  expect(queued).toHaveLength(0);
});

test("the open time is set once, from the reset", () => {
  let now = 1000;
  const probe = new PerfProbe(() => now, () => 0, () => {});
  probe.reset();
  now = 1450;
  probe.opened();
  now = 9000;
  probe.opened();
  expect(perfLines(probe, 42)[2]).toBe("Perf open 450ms, mounted rows 42, loaded rows 0");
});

test("the worst JS frame after content growth is what one page costs", () => {
  let now = 0;
  const queued: Array<() => void> = [];
  const probe = new PerfProbe(() => now, (cb) => { queued.push(cb); return queued.length; }, () => {});
  probe.reset();
  const step = (ms: number) => { now += ms; queued.shift()?.(); };
  probe.activity();
  step(16);
  step(90); // a slow frame before any growth is not a page
  probe.grew(2400);
  step(16);
  step(70);
  step(16);
  probe.render(320);
  expect(perfLines(probe, 40)[3]).toBe("Perf growth 1 times, worst JS frame after one 70ms, screen renders 1");
});
