import { expect, test } from "bun:test";
import { READ_WATCH_MS, ReadProbe, ReadTracker, readTotals, readVerdict } from "../src/omg/read-probe";

function trackerAt() {
  let now = 1_000;
  const tracker = new ReadTracker(() => now);
  return { tracker, advance: (ms: number) => { now += ms; } };
}

test("a page that lands above a held row passes", () => {
  const { tracker, advance } = trackerAt();
  tracker.content(2000);
  tracker.begin();
  tracker.anchor("row-40", 180);
  advance(2500);
  tracker.content(3400);
  tracker.observe(181);
  advance(READ_WATCH_MS);
  expect(readVerdict(tracker.report())).toBe("Reading check passed: 0 moves, 0 lost rows, 1 arrivals, 0 flickers");
});

test("a page that pushes the reader's row down fails", () => {
  const { tracker, advance } = trackerAt();
  tracker.content(2000);
  tracker.begin();
  tracker.anchor("row-40", 180);
  advance(2500);
  tracker.content(3400);
  tracker.observe(1580);
  tracker.observe(1580);
  advance(READ_WATCH_MS);
  expect(readVerdict(tracker.report())).toBe("Reading check failed: 1 moves, 0 lost rows, 1 arrivals, 0 flickers");
});

test("losing the watched row fails, and the watch re-anchors once", () => {
  const { tracker, advance } = trackerAt();
  tracker.content(2000);
  tracker.begin();
  tracker.anchor("stamp-a", 120);
  tracker.content(3400);
  tracker.observe(null);
  expect(tracker.needsAnchor()).toBe(true);
  tracker.anchor("row-1", 150);
  tracker.observe(150);
  advance(READ_WATCH_MS);
  expect(tracker.report()).toMatchObject({ state: "done", losses: 1, moves: 0 });
});

test("a watch where nothing loads, or nothing is on screen, is not a pass", () => {
  const quiet = trackerAt();
  quiet.tracker.begin();
  quiet.tracker.anchor("row-1", 150);
  quiet.advance(READ_WATCH_MS);
  expect(readVerdict(quiet.tracker.report())).toBe("Reading check empty: nothing loaded above");
  const blank = trackerAt();
  blank.tracker.begin();
  blank.advance(READ_WATCH_MS);
  expect(readVerdict(blank.tracker.report())).toBe("Reading check failed: no row on screen to watch");
});

test("a finger on the list ends the watch; its motion is not judged", () => {
  const { tracker } = trackerAt();
  tracker.begin();
  tracker.anchor("row-1", 150);
  tracker.end();
  tracker.observe(900);
  expect(tracker.report()).toMatchObject({ state: "idle", moves: 0 });
});

test("a scroll the app makes does not start a watch; only a released drag does", () => {
  const probe = new ReadProbe(() => 1_000);
  probe.settle();
  expect(probe.tracker.report().state).toBe("idle");
  probe.dragStart();
  probe.settle();
  expect(probe.tracker.report().state).toBe("anchoring");
  probe.reset();
});

test("a shift the next sample undoes is a flicker, reported but not failed", () => {
  const { tracker, advance } = trackerAt();
  tracker.content(2000);
  tracker.begin();
  tracker.anchor("row-40", 180);
  tracker.content(3400);
  tracker.observe(3301);
  tracker.observe(180);
  advance(READ_WATCH_MS);
  expect(readVerdict(tracker.report())).toBe("Reading check passed: 0 moves, 0 lost rows, 1 arrivals, 1 flickers");
});

test("a shift still unconfirmed when the watch ends counts as a move", () => {
  const { tracker, advance } = trackerAt();
  tracker.content(2000);
  tracker.begin();
  tracker.anchor("row-40", 180);
  tracker.content(3400);
  tracker.observe(900);
  advance(READ_WATCH_MS);
  expect(tracker.report()).toMatchObject({ state: "done", moves: 1 });
});

test("totals count each finished watch that saw a load, held or not", () => {
  const { tracker, advance } = trackerAt();
  tracker.content(2000);
  tracker.begin();
  tracker.anchor("row-40", 180);
  tracker.content(3400);
  tracker.observe(180);
  advance(READ_WATCH_MS);
  tracker.begin();
  tracker.anchor("row-10", 180);
  tracker.content(5000);
  tracker.observe(900);
  tracker.observe(900);
  advance(READ_WATCH_MS);
  tracker.begin();
  tracker.anchor("row-5", 180);
  advance(READ_WATCH_MS);
  expect(readTotals(tracker.report())).toBe("Reading totals: 1 held loads, 1 failed loads");
});
