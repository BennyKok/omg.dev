import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import * as settings from "./settings.ts";

const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-composer-fast-mode-"));
  PATHS.data = testData;
  settings.resetSettingsDbConnectionForTests();
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("showComposerFastMode", () => {
  test("defaults off, so a new user does not see Fast mode", () => {
    expect(settings.getGlobalSettingsSync().showComposerFastMode).toBe(false);
  });

  test("persists an on choice, then an off choice", async () => {
    await settings.setGlobalSettings({ showComposerFastMode: true });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync().showComposerFastMode).toBe(true);
    await settings.setGlobalSettings({ showComposerFastMode: false });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync().showComposerFastMode).toBe(false);
  });
});
