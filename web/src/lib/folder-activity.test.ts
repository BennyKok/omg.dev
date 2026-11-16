import { expect, test } from "bun:test";
import { INACTIVE_AFTER_MS, byRecent, splitByActivity } from "./folder-activity";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const f = (...values: string[]) => values.map((value) => ({ value }));
const name = (v: string) => v;

test("byRecent puts the newest folder first and breaks ties by name", () => {
  const activity = new Map([["b", NOW - DAY], ["c", NOW]]);
  expect(byRecent(f("a", "b", "c", "d"), activity, name).map((x) => x.value)).toEqual(["c", "b", "a", "d"]);
});

test("splitByActivity groups folders idle past the cutoff, and folders never used", () => {
  const activity = new Map([["fresh", NOW - DAY], ["old", NOW - INACTIVE_AFTER_MS - DAY]]);
  const { active, inactive } = splitByActivity(f("fresh", "old", "never"), activity, { now: NOW });
  expect(active.map((x) => x.value)).toEqual(["fresh"]);
  expect(inactive.map((x) => x.value)).toEqual(["old", "never"]);
});

test("the current folder stays active whatever its age", () => {
  const activity = new Map([["fresh", NOW]]);
  const { active } = splitByActivity(f("fresh", "old"), activity, { now: NOW, keep: "old" });
  expect(active.map((x) => x.value)).toEqual(["fresh", "old"]);
});

test("with no history at all, nothing is grouped", () => {
  const { active, inactive } = splitByActivity(f("a", "b"), new Map(), { now: NOW });
  expect(active.map((x) => x.value)).toEqual(["a", "b"]);
  expect(inactive).toEqual([]);
});
