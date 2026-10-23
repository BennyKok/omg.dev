import { describe, expect, test } from "bun:test";

import { chatRowHeightKey, createRowHeightCache } from "./row-height-cache";

const base = { rowKey: "s1:m1", metricsVersion: 3, modelVersion: 7, width: 640.4, speakerChanged: false, textLength: 120 };

describe("row height cache", () => {
  test("every input of an estimate changes the key", () => {
    const key = chatRowHeightKey(base);
    for (const change of [
      { rowKey: "s2:m1" },
      { metricsVersion: 4 },
      { modelVersion: 8 },
      { width: 480 },
      { speakerChanged: true },
      { textLength: 121 },
    ]) {
      expect(chatRowHeightKey({ ...base, ...change })).not.toBe(key);
    }
    // Sub-pixel width noise from a fractional layout keeps the entry.
    expect(chatRowHeightKey({ ...base, width: 640.2 })).toBe(key);
  });

  test("keeps entries across uses and drops the oldest tenth when full", () => {
    const cache = createRowHeightCache(20);
    for (let i = 0; i < 20; i++) cache.set(`k${i}`, i);
    expect(cache.size).toBe(20);
    // Reading does not reorder; writing an existing key refreshes it.
    cache.set("k0", 100);
    cache.set("k20", 20);
    expect(cache.size).toBe(19);
    expect(cache.get("k0")).toBe(100);
    expect(cache.get("k1")).toBeUndefined();
    expect(cache.get("k2")).toBeUndefined();
    expect(cache.get("k3")).toBe(3);
    expect(cache.get("k20")).toBe(20);
  });
});
