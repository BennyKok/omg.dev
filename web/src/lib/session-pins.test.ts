import { describe, expect, test } from "bun:test";
import {
  legacyPinnedSessions,
  togglePinnedSession,
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
