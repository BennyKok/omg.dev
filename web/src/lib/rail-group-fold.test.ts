import { describe, expect, test } from "bun:test";
import {
  FOLDED_RAIL_GROUPS_KEY,
  parseFoldedRailGroups,
  readFoldedRailGroups,
  toggleFoldedRailGroup,
  writeFoldedRailGroups,
} from "./rail-group-fold";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

describe("parseFoldedRailGroups", () => {
  test("null, junk and non-arrays parse to empty", () => {
    expect(parseFoldedRailGroups(null)).toEqual([]);
    expect(parseFoldedRailGroups("not json")).toEqual([]);
    expect(parseFoldedRailGroups('{"a":1}')).toEqual([]);
    expect(parseFoldedRailGroups("42")).toEqual([]);
  });

  test("keeps only non-empty strings, deduped, in order", () => {
    expect(parseFoldedRailGroups('["__pinned","",3,"__pinned","code"]')).toEqual([
      "__pinned",
      "code",
    ]);
  });
});

describe("toggleFoldedRailGroup", () => {
  test("adds an absent key and removes a present one", () => {
    expect(toggleFoldedRailGroup([], "__pinned")).toEqual(["__pinned"]);
    expect(toggleFoldedRailGroup(["__pinned", "code"], "__pinned")).toEqual(["code"]);
  });

  test("does not mutate its input", () => {
    const current = ["__pinned"];
    toggleFoldedRailGroup(current, "code");
    expect(current).toEqual(["__pinned"]);
  });
});

describe("read/write round trip", () => {
  test("write persists, read restores, empty write clears the key", () => {
    const storage = memoryStorage();
    writeFoldedRailGroups(["__pinned", "code"], storage);
    expect(readFoldedRailGroups(storage)).toEqual(["__pinned", "code"]);
    writeFoldedRailGroups([], storage);
    expect(storage.getItem(FOLDED_RAIL_GROUPS_KEY)).toBeNull();
    expect(readFoldedRailGroups(storage)).toEqual([]);
  });

  test("a broken stored value reads as nothing folded", () => {
    const storage = memoryStorage({ [FOLDED_RAIL_GROUPS_KEY]: "{oops" });
    expect(readFoldedRailGroups(storage)).toEqual([]);
  });
});
