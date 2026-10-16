import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import * as settings from "./settings.ts";

// Hosted omg.dev Computers do not offer Bots, so their web app must never load
// /api/bots. A self-run box keeps Bots, on by default.
const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-hosted-bots-"));
  PATHS.data = testData;
  settings.resetSettingsDbConnectionForTests();
});

afterEach(() => {
  settings.setHostedComputerForTests(null);
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("showBots", () => {
  test("a self-run box shows Bots by default and keeps an off choice", async () => {
    settings.setHostedComputerForTests(false);
    expect(settings.getGlobalSettingsSync().showBots).toBe(true);
    await settings.setGlobalSettings({ showBots: false });
    expect(settings.getGlobalSettingsSync().showBots).toBe(false);
    await settings.setGlobalSettings({ showBots: true });
  });

  test("a hosted Computer reads Bots as off, even where an old save stored on", async () => {
    settings.setHostedComputerForTests(false);
    await settings.setGlobalSettings({ showBots: true });
    settings.setHostedComputerForTests(true);
    expect(settings.getGlobalSettingsSync().showBots).toBe(false);
    expect((await settings.setGlobalSettings({ showBots: true })).showBots).toBe(false);
  });
});
