import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  importSessionPins,
  listSessionPins,
  pruneSessionPins,
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

  test("prunes ended sessions against the authoritative live roster", () => {
    expect(pruneSessionPins(new Set(["phone", "laptop"]))).toEqual(["phone", "laptop"]);
    expect(listSessionPins()).toEqual(["phone", "laptop"]);
  });

  test("survives a database reconnect", () => {
    resetSessionPinsDbConnectionForTests();
    expect(listSessionPins()).toEqual(["phone", "laptop"]);
  });
});
