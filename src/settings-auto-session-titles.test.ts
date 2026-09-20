import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import * as settings from "./settings.ts";

const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-auto-session-titles-"));
  PATHS.data = testData;
  settings.resetSettingsDbConnectionForTests();
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("autoSessionTitles", () => {
  // On by default, including on a box with no omg account. The generator
  // returns null there and the prompt-derived title stays, so defaulting off
  // would only cost the users who do have an account a settings trip.
  test("defaults to on for boxes that predate the setting", () => {
    expect(settings.getGlobalSettingsSync().autoSessionTitles).toBe("on");
  });

  test("persists a manual choice", async () => {
    await settings.setGlobalSettings({ autoSessionTitles: "manual" });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync().autoSessionTitles).toBe("manual");
  });

  test("persists off", async () => {
    await settings.setGlobalSettings({ autoSessionTitles: "off" });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync().autoSessionTitles).toBe("off");
  });

  // A value written by a newer build must not read as "off" on an older one.
  // Failing open matters here: the wrong direction silently disables a feature
  // the user turned on.
  test("an unknown stored value falls back to on", async () => {
    await settings.setGlobalSettings({ autoSessionTitles: "sometimes" as never });
    expect(settings.getGlobalSettingsSync().autoSessionTitles).toBe("on");
  });

  test("the validator accepts the three modes and nothing else", () => {
    expect(settings.validAutoSessionTitles("on")).toBe(true);
    expect(settings.validAutoSessionTitles("manual")).toBe(true);
    expect(settings.validAutoSessionTitles("off")).toBe(true);
    expect(settings.validAutoSessionTitles("sometimes")).toBe(false);
    expect(settings.validAutoSessionTitles(true)).toBe(false);
    expect(settings.validAutoSessionTitles(undefined)).toBe(false);
  });
});
