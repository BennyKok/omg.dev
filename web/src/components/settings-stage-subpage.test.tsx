import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { SETTINGS_STAGE_SUBPAGES, SettingsStageSubpage } = await import("./settings-stage-subpage");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

describe("SettingsStageSubpage", () => {
  test("shows Back to Settings above the page and calls onBack", async () => {
    let backs = 0;
    ui.render(
      <SettingsStageSubpage onBack={() => backs++}>
        <p>Storage page</p>
      </SettingsStageSubpage>,
    );
    expect(ui.text()).toContain("Settings");
    expect(ui.text()).toContain("Storage page");
    await ui.flushAsync(() => (ui.query('button[aria-label="Back to Settings"]') as HTMLButtonElement).click());
    expect(backs).toBe(1);
  });

  test("Terminal and Computer stay full-screen; the Settings pages ride the stage", () => {
    for (const page of ["storage", "instructions", "connectors", "more", "usage", "changelog"]) {
      expect(SETTINGS_STAGE_SUBPAGES.has(page)).toBe(true);
    }
    expect(SETTINGS_STAGE_SUBPAGES.has("term")).toBe(false);
    expect(SETTINGS_STAGE_SUBPAGES.has("computer")).toBe(false);
  });
});
