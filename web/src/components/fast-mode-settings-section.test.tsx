import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { FastModeSettingsSection } = await import("./fast-mode-settings-section");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

test("the switch reflects the setting and saves the flipped value", () => {
  const patches: unknown[] = [];
  ui.render(
    <FastModeSettingsSection
      settings={{ showComposerFastMode: false }}
      onChange={async (patch) => {
        patches.push(patch);
      }}
    />,
  );
  expect(ui.text()).toContain("Fast mode");
  const toggle = ui.query('[role="switch"][aria-label="Show Fast mode in the composer"]') as HTMLElement;
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  ui.flush(() => toggle.click());
  expect(patches).toEqual([{ showComposerFastMode: true }]);
});
