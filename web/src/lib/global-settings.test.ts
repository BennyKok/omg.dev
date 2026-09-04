// A Computer can run an older omg.dev build than the UI the dashboard embeds.
// Its /api/bootstrap answer then omits fields this build renders, and the
// Settings page crashed on `customInstructions.trim()` when the answer
// replaced the defaults wholesale.
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_GLOBAL_SETTINGS,
  resolveGlobalSettings,
  type GlobalSettings,
} from "./global-settings";

describe("resolveGlobalSettings", () => {
  test("an older box that sends no customInstructions still resolves a string", () => {
    const older: Partial<GlobalSettings> = {
      timeZone: "Asia/Hong_Kong",
      maxLiveAgents: 4,
      transcriptView: "full",
    };

    const settings = resolveGlobalSettings(older);

    expect(settings.customInstructions).toBe("");
    expect(settings.customInstructions.trim()).toBe("");
    expect(settings.timeZone).toBe("Asia/Hong_Kong");
    expect(settings.maxLiveAgents).toBe(4);
    expect(settings.showComposerFastMode).toBe(true);
  });

  test("a null or absent answer resolves to the defaults", () => {
    expect(resolveGlobalSettings(null)).toEqual(DEFAULT_GLOBAL_SETTINGS);
    expect(resolveGlobalSettings(undefined)).toEqual(DEFAULT_GLOBAL_SETTINGS);
  });

  test("a stored null field takes the default instead of overwriting it", () => {
    const settings = resolveGlobalSettings({
      customInstructions: null,
      defaultAgent: null,
    } as unknown as Partial<GlobalSettings>);

    expect(settings.customInstructions).toBe("");
    expect(settings.defaultAgent).toBe("");
  });

  test("every sent value wins, including a deliberate empty string and false", () => {
    const settings = resolveGlobalSettings({
      customInstructions: "Always run the tests.",
      skippedUpdateVersion: "",
      showBots: false,
      maxLiveAgents: 0,
    });

    expect(settings.customInstructions).toBe("Always run the tests.");
    expect(settings.skippedUpdateVersion).toBe("");
    expect(settings.showBots).toBe(false);
    expect(settings.maxLiveAgents).toBe(0);
  });

  test("the resolved object carries every key the UI renders", () => {
    expect(Object.keys(resolveGlobalSettings({})).sort()).toEqual(
      Object.keys(DEFAULT_GLOBAL_SETTINGS).sort(),
    );
  });
});
