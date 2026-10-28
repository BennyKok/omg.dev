import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import * as settings from "./settings.ts";
import { snapforkEnabled, snapforkStatus, snapforkSupport } from "./snapfork.ts";

const originalData = PATHS.data;
const originalEnv = process.env.LFG_SNAPFORK;
let testData = "";

beforeAll(async () => {
  testData = await mkdtemp(join(tmpdir(), "lfg-snapshot-forks-"));
  PATHS.data = testData;
  settings.resetSettingsDbConnectionForTests();
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.LFG_SNAPFORK;
  else process.env.LFG_SNAPFORK = originalEnv;
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("snapshotForks", () => {
  test("defaults off, so nobody gets snapshot forks without opting in", () => {
    delete process.env.LFG_SNAPFORK;
    expect(settings.getGlobalSettingsSync().snapshotForks).toBe(false);
    expect(snapforkEnabled()).toBe(false);
  });

  test("persists the opt-in; it takes effect only where the box supports it", async () => {
    delete process.env.LFG_SNAPFORK;
    await settings.setGlobalSettings({ snapshotForks: true });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync().snapshotForks).toBe(true);
    expect(snapforkEnabled()).toBe(snapforkSupport().supported);
    await settings.setGlobalSettings({ snapshotForks: false });
    settings.resetSettingsDbConnectionForTests();
    expect(snapforkEnabled()).toBe(false);
  });

  test("LFG_SNAPFORK overrides the setting in both directions", async () => {
    await settings.setGlobalSettings({ snapshotForks: true });
    process.env.LFG_SNAPFORK = "0";
    expect(snapforkEnabled()).toBe(false);
    expect(snapforkStatus().envOverride).toBe("off");
    await settings.setGlobalSettings({ snapshotForks: false });
    process.env.LFG_SNAPFORK = "1";
    expect(snapforkEnabled()).toBe(snapforkSupport().supported);
    expect(snapforkStatus().envOverride).toBe("on");
  });
});
