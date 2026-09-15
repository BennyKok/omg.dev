/**
 * The onboarding flow's content. Every string a person reads in steps 02 to 05
 * lives in one file; these are the rules that file has to keep.
 */
import { expect, test } from "bun:test";
import {
  FALLBACK_WORD,
  INTEREST_LANES,
  headlineWord,
  laneFor,
  promptFor,
} from "../src/omg/onboarding-tasks";

test("every lane offers three example tasks and its own tools", () => {
  expect(INTEREST_LANES).toHaveLength(4);
  for (const lane of INTEREST_LANES) {
    expect(lane.tasks).toHaveLength(3);
    expect(lane.tools.length).toBeGreaterThan(0);
  }
});

test("task ids are unique, because a remembered choice is looked up by one", () => {
  const ids = INTEREST_LANES.flatMap((lane) => lane.tasks.map((task) => task.id));
  expect(new Set(ids).size).toBe(ids.length);
});

/**
 * Screen 03 opens the editor already written out. A task whose prompt is a
 * restatement of its own label teaches nothing, so every prompt has to say
 * more than the row that led to it.
 */
test("every task prefills a prompt that says more than its label", () => {
  for (const lane of INTEREST_LANES) {
    for (const task of lane.tasks) {
      expect(promptFor(lane.key, task.id)).toBe(task.prompt);
      expect(task.prompt.length).toBeGreaterThan(task.label.length + 30);
      expect(task.prompt.trim().endsWith(".")).toBe(true);
    }
  }
});

/**
 * Benny: vary the sample subject per lane. A single invented brand across all
 * four would read as filler by the second screen.
 */
test("the lanes do not share one sample subject", () => {
  const design = INTEREST_LANES.find((l) => l.key === "design")!;
  const sales = INTEREST_LANES.find((l) => l.key === "sales")!;
  expect(design.tasks.every((t) => t.prompt.includes("Daybreak Coffee"))).toBe(true);
  expect(sales.tasks.every((t) => t.prompt.includes("Northwind Supply"))).toBe(true);
  expect(design.tasks.some((t) => t.prompt.includes("Northwind"))).toBe(false);
  expect(sales.tasks.some((t) => t.prompt.includes("Daybreak"))).toBe(false);
});

/** No screen promises a free run any more; the copy that did was removed. */
test("no prompt promises anything free", () => {
  for (const lane of INTEREST_LANES) {
    for (const task of lane.tasks) {
      expect(task.prompt.toLowerCase()).not.toContain("on us");
      expect(task.prompt.toLowerCase()).not.toContain("free");
    }
  }
});

test("screen 05 uses the lane's own word, and falls back to chat", () => {
  expect(headlineWord("design")).toBe("design");
  expect(headlineWord("code")).toBe("code");
  expect(headlineWord("data")).toBe("insights");
  expect(headlineWord("sales")).toBe("sales");
  // The custom-idea path never picks a lane.
  expect(headlineWord(null)).toBe(FALLBACK_WORD);
  expect(headlineWord(undefined)).toBe(FALLBACK_WORD);
});

test("the custom path starts blank rather than prefilled", () => {
  expect(promptFor(null, null)).toBeNull();
  expect(promptFor("design", "not-a-task")).toBeNull();
  expect(laneFor(null)).toBeNull();
});
