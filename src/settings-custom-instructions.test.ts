// GlobalSettings.customInstructions is the owner's standing instructions,
// appended to the launch envelope of every new session by
// withOmgRuntimeContract. This file covers the store: the length budget, the
// trim, and the round trip through sqlite. The envelope itself is covered in
// src/omg-capabilities.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import * as settings from "./settings.ts";

const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  // Same reason as src/settings-bot-schedule-cap.test.ts: settings.ts caches an
  // open sqlite handle, so PATHS.data must be reassigned AND the handle
  // dropped, or this file writes into the real data dir of whatever box runs it.
  testData = await mkdtemp(join(tmpdir(), "lfg-custom-instructions-"));
  PATHS.data = testData;
  settings.resetSettingsDbConnectionForTests();
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("customInstructions", () => {
  test("defaults to empty, so an untouched box appends nothing", () => {
    expect(settings.getGlobalSettingsSync().customInstructions).toBe("");
  });

  test("round trips through sqlite", async () => {
    const saved = await settings.setGlobalSettings({
      customInstructions: "Always run the tests before you say you are done.",
    });
    expect(saved.customInstructions).toBe("Always run the tests before you say you are done.");
    expect(settings.getGlobalSettingsSync().customInstructions).toBe(
      "Always run the tests before you say you are done.",
    );
  });

  test("trims, so a field left with a trailing newline does not pad the envelope", async () => {
    const saved = await settings.setGlobalSettings({ customInstructions: "  ask first\n\n" });
    expect(saved.customInstructions).toBe("ask first");
  });

  test("clears back to empty", async () => {
    await settings.setGlobalSettings({ customInstructions: "something" });
    const saved = await settings.setGlobalSettings({ customInstructions: "   " });
    expect(saved.customInstructions).toBe("");
    expect(settings.getGlobalSettingsSync().customInstructions).toBe("");
  });

  test("caps at CUSTOM_INSTRUCTIONS_MAX_LENGTH — every session pays this in context", async () => {
    const saved = await settings.setGlobalSettings({
      customInstructions: "x".repeat(settings.CUSTOM_INSTRUCTIONS_MAX_LENGTH + 500),
    });
    expect(saved.customInstructions.length).toBe(settings.CUSTOM_INSTRUCTIONS_MAX_LENGTH);
  });

  test("a non-string stored value degrades to empty instead of reaching a prompt", async () => {
    const saved = await settings.setGlobalSettings({
      customInstructions: 42 as unknown as string,
    });
    expect(saved.customInstructions).toBe("");
  });

  test("editing it leaves the other settings alone", async () => {
    await settings.setGlobalSettings({ maxBotSchedules: 3, customInstructions: "keep me" });
    const after = await settings.setGlobalSettings({ customInstructions: "replaced" });
    expect(after.customInstructions).toBe("replaced");
    expect(after.maxBotSchedules).toBe(3);
  });
});
