import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import * as settings from "./settings.ts";

const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-sidebar-favicons-"));
  PATHS.data = testData;
  settings.resetSettingsDbConnectionForTests();
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("showSidebarFavicons", () => {
  test("defaults on for boxes that predate the setting", () => {
    expect(settings.getGlobalSettingsSync().showSidebarFavicons).toBe(true);
  });

  test("persists an off choice", async () => {
    await settings.setGlobalSettings({ showSidebarFavicons: false });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync().showSidebarFavicons).toBe(false);
  });
});
