import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  getSessionUserFilter,
  isStorableUserFilter,
  resetSessionUserFilterDbConnectionForTests,
  setSessionUserFilter,
} from "./session-user-filter.ts";

const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "omg-session-user-filter-"));
  PATHS.data = testData;
  resetSessionUserFilterDbConnectionForTests();
});

afterAll(async () => {
  resetSessionUserFilterDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("per-viewer session owner filter", () => {
  test("stores one filter per viewer, case-insensitive on the viewer", () => {
    expect(getSessionUserFilter("a@example.com")).toBeNull();
    setSessionUserFilter("A@Example.com", "a@example.com");
    setSessionUserFilter("b@example.com", "__all");
    expect(getSessionUserFilter("a@example.com")).toBe("a@example.com");
    expect(getSessionUserFilter("b@example.com")).toBe("__all");
    setSessionUserFilter("a@example.com", "__unassigned");
    expect(getSessionUserFilter("a@example.com")).toBe("__unassigned");
  });

  test("survives a reconnect", () => {
    resetSessionUserFilterDbConnectionForTests();
    expect(getSessionUserFilter("b@example.com")).toBe("__all");
  });

  test("rejects empty and oversized values", () => {
    expect(isStorableUserFilter("")).toBe(false);
    expect(isStorableUserFilter(3)).toBe(false);
    expect(isStorableUserFilter("x".repeat(321))).toBe(false);
    expect(isStorableUserFilter("__all")).toBe(true);
  });
});
