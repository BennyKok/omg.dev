import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import * as settings from "./settings.ts";

const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-fixed-view-toggles-"));
  PATHS.data = testData;
  settings.resetSettingsDbConnectionForTests();
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

// Settings no longer offers these switches. A stored `false` from before the
// cleanup must not leave part of the interface hidden with no way back.
const FIXED_ON = [
  "showSidebarAgentIcons",
  "showSessionAgentIcons",
  "showSessionDiffBar",
  "showComposerAgents",
  "showComposerModels",
] as const;

describe("view toggles that Settings no longer offers", () => {
  test("a stored off is read as on", async () => {
    await settings.setGlobalSettings(Object.fromEntries(FIXED_ON.map((k) => [k, false])));
    settings.resetSettingsDbConnectionForTests();
    const read = settings.getGlobalSettingsSync();
    for (const key of FIXED_ON) expect(read[key]).toBe(true);
  });

  test("a switch Settings still offers keeps its stored value", async () => {
    await settings.setGlobalSettings({ showSidebarFavicons: false });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync().showSidebarFavicons).toBe(false);
  });
});
