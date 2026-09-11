import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import * as settings from "./settings.ts";

const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-composer-send-mode-"));
  PATHS.data = testData;
  settings.resetSettingsDbConnectionForTests();
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("composerSendMode", () => {
  test("defaults to steer for boxes that predate the setting", () => {
    expect(settings.getGlobalSettingsSync().composerSendMode).toBe("steer");
  });

  test("persists a queue choice", async () => {
    await settings.setGlobalSettings({ composerSendMode: "queue" });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync().composerSendMode).toBe("queue");
  });

  test("an unknown stored value falls back to steer", async () => {
    await settings.setGlobalSettings({ composerSendMode: "later" as never });
    expect(settings.getGlobalSettingsSync().composerSendMode).toBe("steer");
  });
});
