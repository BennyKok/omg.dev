import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import * as settings from "./settings.ts";

const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-session-details-"));
  PATHS.data = testData;
  settings.resetSettingsDbConnectionForTests();
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("showSessionDetails", () => {
  test("defaults off, so every box shows compact session rows", () => {
    expect(settings.getGlobalSettingsSync().showSessionDetails).toBe(false);
  });

  test("persists an on choice across restarts", async () => {
    await settings.setGlobalSettings({ showSessionDetails: true });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync().showSessionDetails).toBe(true);
  });
});

describe("showThreads", () => {
  test("defaults off, so the lists start with sessions", () => {
    expect(settings.getGlobalSettingsSync().showThreads).toBe(false);
  });

  test("persists an on choice across restarts, so threads come back for whoever turns them on", async () => {
    await settings.setGlobalSettings({ showThreads: true });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync().showThreads).toBe(true);
  });
});
