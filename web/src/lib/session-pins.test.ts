import { describe, expect, test } from "bun:test";
import {
  legacyPinnedSessions,
  togglePinnedSession,
  withPinnedFamilies,
} from "./session-pins";

describe("session pin client helpers", () => {
  test("deduplicates and validates legacy browser pins for one-time migration", () => {
    expect(legacyPinnedSessions('["alpha", "", "alpha", 3, "beta"]')).toEqual([
      "alpha",
      "beta",
    ]);
    expect(legacyPinnedSessions("not json")).toEqual([]);
    expect(legacyPinnedSessions(null)).toEqual([]);
  });

  test("optimistically toggles only the requested pin", () => {
    expect(togglePinnedSession(["phone"], "laptop")).toEqual(["phone", "laptop"]);
    expect(togglePinnedSession(["phone", "laptop"], "phone")).toEqual(["laptop"]);
  });
});

describe("withPinnedFamilies", () => {
  const a = { sessionId: "a", project: "one" };
  const b = { sessionId: "b", project: "two" };
  const bChild = { sessionId: "b1", project: "two", parentSessionId: "b" };
  const c = { sessionId: "c", project: "two" };
  const all = [a, b, bChild, c];

  test("adds a pinned session from another project, in list order", () => {
    expect(withPinnedFamilies([a], all, ["c"])).toEqual([a, c]);
  });

  test("a pinned child brings its parent and siblings", () => {
    expect(withPinnedFamilies([a], all, ["b1"])).toEqual([a, b, bChild]);
  });

  test("returns the same array when nothing is added", () => {
    const scoped = [a];
    expect(withPinnedFamilies(scoped, all, [])).toBe(scoped);
    expect(withPinnedFamilies(scoped, all, ["a"])).toBe(scoped);
    expect(withPinnedFamilies(scoped, all, ["gone"])).toBe(scoped);
  });

  test("a pin outside the candidates (another user's) is not added", () => {
    expect(withPinnedFamilies([a], [a, c], ["b"])).toEqual([a]);
  });

  test("survives a parent cycle", () => {
    const x = { sessionId: "x", parentSessionId: "y" };
    const y = { sessionId: "y", parentSessionId: "x" };
    expect(withPinnedFamilies([a], [a, x, y], ["x"])).toEqual([a, x, y]);
  });
});
