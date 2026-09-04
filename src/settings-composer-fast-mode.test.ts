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
  test("defaults on for boxes that predate the setting", () => {
    expect(settings.getGlobalSettingsSync().showComposerFastMode).toBe(true);
  });

  test("persists an off choice", async () => {
    await settings.setGlobalSettings({ showComposerFastMode: false });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync().showComposerFastMode).toBe(false);
  });
});
