import { beforeEach, describe, expect, test } from "bun:test";
import {
  FOLDED_RAIL_GROUPS_KEY,
  getFoldedRailGroups,
  parseFoldedRailGroups,
  readFoldedRailGroups,
  resetFoldedRailGroupsCache,
  setFoldedRailGroup,
  subscribeFoldedRailGroups,
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

describe("the live fold store", () => {
  beforeEach(() => {
    resetFoldedRailGroupsCache();
  });

  test("a group folds and unfolds when storage refuses every write", () => {
    // Private mode and a full quota both look like this. The reader must
    // still be able to reopen what they just shut.
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: blocked,
      configurable: true,
    });
    try {
      expect(getFoldedRailGroups()).toEqual([]);
      setFoldedRailGroup("lfg", true);
      expect(getFoldedRailGroups()).toEqual(["lfg"]);
      setFoldedRailGroup("lfg", false);
      expect(getFoldedRailGroups()).toEqual([]);
    } finally {
      if (original === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
      else
        Object.defineProperty(globalThis, "localStorage", {
          value: original,
          configurable: true,
        });
    }
  });

  test("setFoldedRailGroup is a set, not a toggle, and repeats are no-ops", () => {
    const seen: string[][] = [];
    const stop = subscribeFoldedRailGroups(() => seen.push(getFoldedRailGroups()));
    setFoldedRailGroup("lfg", true);
    const afterFirst = getFoldedRailGroups();
    setFoldedRailGroup("lfg", true);
    // Same answer asked twice must not churn the snapshot, or every
    // subscriber re-renders for nothing.
    expect(getFoldedRailGroups()).toBe(afterFirst);
    expect(seen.length).toBe(1);
    stop();
    setFoldedRailGroup("vibes", true);
    expect(seen.length).toBe(1);
  });
});

test("a host with no localStorage reads and writes without throwing", () => {
  // The store seeds itself on first read. A runner or a server render with no
  // DOM must get an empty set, not a ReferenceError.
  expect(() => readFoldedRailGroups(null)).not.toThrow();
  expect(readFoldedRailGroups(null)).toEqual([]);
  expect(() => writeFoldedRailGroups(["lfg"], null)).not.toThrow();
});
