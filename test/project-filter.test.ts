import { describe, expect, test } from "bun:test";
import {
  cacheProjectFilter,
  NO_PROJECT_FILTER,
  PROJECT_FILTER_STORAGE_KEY,
  readCachedProjectFilter,
} from "../web/src/lib/project-filter";

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("project filter cache", () => {
  test("restores a project picked in this visit", () => {
    const storage = memoryStorage();
    cacheProjectFilter("lfg", storage);
    expect(readCachedProjectFilter(storage)).toBe("lfg");
  });

  test("persists project selection for every app surface, including embeds", () => {
    const storage = memoryStorage();

    cacheProjectFilter("omg", storage);

    expect(readCachedProjectFilter(storage)).toBe("omg");
  });

  test("falls back to no project when no selection has been made", () => {
    expect(readCachedProjectFilter(memoryStorage())).toBe(NO_PROJECT_FILTER);
  });

  test("ignores a bare value left by the old localStorage format", () => {
    const storage = memoryStorage({ [PROJECT_FILTER_STORAGE_KEY]: "lfg" });
    expect(readCachedProjectFilter(storage)).toBe(NO_PROJECT_FILTER);
  });
});
