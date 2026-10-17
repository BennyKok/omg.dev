import { expect, test } from "bun:test";
import { FollowProbe, followVerdict, WATCH_MS } from "../src/omg/follow-probe";

const VIEW = 1000;

function probeAt() {
  let now = 1_000;
  const probe = new FollowProbe(() => now);
  return { probe, advance: (ms: number) => { now += ms; } };
}

/** Drag up to read, then back to the bottom, as the plan does. */
function readAndReturn(probe: FollowProbe) {
  probe.content(3000);
  probe.dragStart();
  probe.scroll(1500, 3000, VIEW);
  probe.scroll(2000, 3000, VIEW);
  probe.settle();
}

test("judges nothing until the reader has dragged once", () => {
  const { probe } = probeAt();
  probe.scroll(2000, 3000, VIEW);
  probe.content(2500);
  probe.scroll(1500, 2500, VIEW);
  probe.bottom(false);
  const report = probe.report();
  expect(report.state).toBe("idle");
  expect(report.jumps).toBe(0);
  expect(report.latestFlashes).toBe(0);
});

test("the recorded glitch fails: a shrink, a jump up, a glide back with Latest shown", () => {
  const { probe, advance } = probeAt();
  readAndReturn(probe);
  advance(1800);
  probe.content(2530);
  probe.scroll(1530, 2530, VIEW);
  probe.bottom(false);
  probe.content(3000);
  for (const offset of [1600, 1750, 1900, 2000]) probe.scroll(offset, 3000, VIEW);
  probe.bottom(true);
  advance(WATCH_MS);
  const report = probe.report();
  expect(report.state).toBe("done");
  expect(report).toMatchObject({ jumps: 1, latestFlashes: 1, shrinks: 1 });
  expect(followVerdict(report)).toBe("Follow check failed: 1 jumps, 1 Latest flashes, 1 shrinks");
});

test("a list that only follows downward passes", () => {
  const { probe, advance } = probeAt();
  readAndReturn(probe);
  for (const offset of [2010, 2030, 2060]) {
    advance(1000);
    probe.content(offset + VIEW);
    probe.scroll(offset, offset + VIEW, VIEW);
  }
  advance(WATCH_MS);
  expect(followVerdict(probe.report())).toBe("Follow check passed: 0 jumps, 0 Latest flashes, 0 shrinks");
});

test("motion under a finger, or a coast, is the reader's and does not count", () => {
  const { probe, advance } = probeAt();
  readAndReturn(probe);
  probe.dragStart();
  probe.scroll(500, 3000, VIEW);
  probe.bottom(false);
  probe.scroll(2000, 3000, VIEW);
  advance(500);
  probe.settle();
  advance(WATCH_MS);
  expect(probe.report()).toMatchObject({ state: "done", jumps: 0, latestFlashes: 0 });
});

test("a list left away from the bottom is not judged, because it is not following", () => {
  const { probe, advance } = probeAt();
  probe.content(3000);
  probe.dragStart();
  probe.scroll(800, 3000, VIEW);
  probe.settle();
  probe.scroll(700, 3000, VIEW);
  advance(WATCH_MS * 2);
  const report = probe.report();
  expect(report.state).toBe("away");
  expect(report.jumps).toBe(0);
  expect(followVerdict(report)).toBe("Follow check waiting: return to the latest message");
});

test("the watch starts when Latest brings the list back to the bottom", () => {
  const { probe, advance } = probeAt();
  probe.content(3000);
  probe.dragStart();
  probe.scroll(800, 3000, VIEW);
  probe.settle();
  advance(5000);
  for (const offset of [1200, 1700, 2000]) probe.scroll(offset, 3000, VIEW);
  expect(probe.report()).toMatchObject({ state: "watching", watchedMs: 0 });
  advance(WATCH_MS);
  expect(probe.report().state).toBe("done");
});

test("the verdict freezes after the watch, and a new drag starts a new watch", () => {
  const { probe, advance } = probeAt();
  readAndReturn(probe);
  advance(WATCH_MS);
  expect(probe.report().state).toBe("done");
  probe.scroll(1000, 3000, VIEW);
  expect(probe.report().jumps).toBe(0);
  readAndReturn(probe);
  expect(probe.report().state).toBe("watching");
});
