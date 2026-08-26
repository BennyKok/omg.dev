import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  importSessionPins,
  listSessionPins,
  visibleSessionPins,
  resetSessionPinsDbConnectionForTests,
  setSessionPinned,
} from "./session-pins.ts";

const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "omg-session-pins-"));
  PATHS.data = testData;
  resetSessionPinsDbConnectionForTests();
});

afterAll(async () => {
  resetSessionPinsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("server-owned session pins", () => {
  test("keeps insertion order and makes repeated mutations idempotent", () => {
    setSessionPinned("alpha", true);
    setSessionPinned("alpha", true);
    setSessionPinned("beta", true);
    expect(listSessionPins()).toEqual(["alpha", "beta"]);

    setSessionPinned("alpha", false);
    setSessionPinned("alpha", false);
    expect(listSessionPins()).toEqual(["beta"]);
  });

  test("merges legacy device state without replacing pins from another device", () => {
    importSessionPins(["phone", "shared", "phone"]);
    importSessionPins(["laptop", "shared"]);
    expect(listSessionPins()).toEqual(["beta", "phone", "shared", "laptop"]);
  });

  test("hides ended sessions from the live view", () => {
    expect(visibleSessionPins(new Set(["phone", "laptop"]))).toEqual(["phone", "laptop"]);
  });

  // The regression this file exists for. The live roster comes from a /proc
  // scan that reports an empty list on any read failure, so a read that
  // DELETED against it would wipe every device's pins on one bad scan.
  test("an empty roster hides every pin without destroying one", () => {
    expect(visibleSessionPins(new Set())).toEqual([]);
    expect(listSessionPins()).toEqual(["beta", "phone", "shared", "laptop"]);
  });

  test("a pin missing from one roster survives to be shown by the next", () => {
    expect(visibleSessionPins(new Set(["phone"]))).toEqual(["phone"]);
    expect(visibleSessionPins(new Set(["phone", "laptop"]))).toEqual(["phone", "laptop"]);
  });

  test("only an explicit unpin removes a row", () => {
    setSessionPinned("shared", false);
    expect(listSessionPins()).toEqual(["beta", "phone", "laptop"]);
  });

  test("survives a database reconnect", () => {
    resetSessionPinsDbConnectionForTests();
    expect(listSessionPins()).toEqual(["beta", "phone", "laptop"]);
  });
});
