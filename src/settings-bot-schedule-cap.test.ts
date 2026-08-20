// The per-bot schedule cap (src/settings.ts's maxBotSchedules) is the first
// layer of "runaway self-scheduling" (docs/bot-owned-automations-plan.md §7):
// always >= 1 (no 0-as-unlimited escape hatch, unlike maxLiveAgents), clamped
// to BOT_SCHEDULE_LIMIT, defaulting to DEFAULT_MAX_BOT_SCHEDULES on anything
// invalid.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import * as settings from "./settings.ts";

const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  // Unlike src/auto/store.ts (agentsPath() etc. are lazy, computed per call),
  // settings.ts caches an open sqlite handle across calls. A plain PATHS.data
  // reassignment + dynamic re-import is not enough here: by the time this
  // file's beforeAll runs, some other test file's static `import
  // "./serve.ts"` (which itself imports settings.ts) has near-certainly
  // already loaded this module — reassigning PATHS.data afterward would
  // silently keep pointing at whatever real, on-disk database this box's own
  // data dir holds. resetSettingsDbConnectionForTests() drops that cached
  // handle so the next call reopens against the freshly-set PATHS.data.
  testData = await mkdtemp(join(tmpdir(), "lfg-bot-schedule-cap-"));
  PATHS.data = testData;
  settings.resetSettingsDbConnectionForTests();
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("maxBotSchedules sanitize clamp", () => {
  test("defaults to DEFAULT_MAX_BOT_SCHEDULES when nothing has been set", () => {
    expect(settings.getGlobalSettingsSync().maxBotSchedules).toBe(
      settings.DEFAULT_MAX_BOT_SCHEDULES,
    );
  });

  test("stores a valid value as-is", async () => {
    const saved = await settings.setGlobalSettings({ maxBotSchedules: 3 });
    expect(saved.maxBotSchedules).toBe(3);
    expect(settings.getGlobalSettingsSync().maxBotSchedules).toBe(3);
  });

  test("0 is rejected, unlike maxLiveAgents — an unlimited bot is the exact failure mode the cap exists to prevent", async () => {
    const saved = await settings.setGlobalSettings({ maxBotSchedules: 0 });
    expect(saved.maxBotSchedules).toBe(settings.DEFAULT_MAX_BOT_SCHEDULES);
  });

  test("negative values fall back to the default", async () => {
    const saved = await settings.setGlobalSettings({ maxBotSchedules: -5 });
    expect(saved.maxBotSchedules).toBe(settings.DEFAULT_MAX_BOT_SCHEDULES);
  });

  test("a non-integer falls back to the default", async () => {
    const saved = await settings.setGlobalSettings({ maxBotSchedules: 2.5 });
    expect(saved.maxBotSchedules).toBe(settings.DEFAULT_MAX_BOT_SCHEDULES);
  });

  test("clamps above BOT_SCHEDULE_LIMIT rather than storing an unbounded value", async () => {
    const saved = await settings.setGlobalSettings({ maxBotSchedules: 999 });
    expect(saved.maxBotSchedules).toBe(settings.BOT_SCHEDULE_LIMIT);
  });

  test("the hard ceiling itself is accepted", async () => {
    const saved = await settings.setGlobalSettings({
      maxBotSchedules: settings.BOT_SCHEDULE_LIMIT,
    });
    expect(saved.maxBotSchedules).toBe(settings.BOT_SCHEDULE_LIMIT);
  });

  test("an unrelated patch does not disturb the stored cap", async () => {
    await settings.setGlobalSettings({ maxBotSchedules: 7 });
    const saved = await settings.setGlobalSettings({ timeZone: "UTC" });
    expect(saved.maxBotSchedules).toBe(7);
  });
});

describe("persistent bot compaction settings", () => {
  test("defaults to proactive compaction at a conservative threshold", () => {
    const value = settings.getGlobalSettingsSync();
    expect(value.botAutoCompactionEnabled).toBe(true);
    expect(value.botCompactionThresholdPercent).toBeGreaterThanOrEqual(70);
    expect(value.botCompactionThresholdPercent).toBeLessThan(90);
  });

  test("persists the switch and threshold across reads", async () => {
    await settings.setGlobalSettings({
      botAutoCompactionEnabled: false,
      botCompactionThresholdPercent: 84,
    });
    settings.resetSettingsDbConnectionForTests();
    expect(settings.getGlobalSettingsSync()).toMatchObject({
      botAutoCompactionEnabled: false,
      botCompactionThresholdPercent: 84,
    });
  });
});
