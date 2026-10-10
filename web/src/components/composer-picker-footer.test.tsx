import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { ComposerPickerFooter } = await import("./composer-picker-footer");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const thinking = {
  options: [
    { id: "low", label: "Low", selected: false },
    { id: "high", label: "High", selected: true },
  ],
  onPick: () => {},
};

test("shows Thinking and a Fast mode switch that toggles", () => {
  let toggles = 0;
  ui.render(<ComposerPickerFooter thinking={thinking} fast={{ enabled: false, onToggle: () => toggles++ }} />);
  expect(ui.text()).toContain("Thinking");
  expect(ui.text()).toContain("Fast mode");
  const fastSwitch = ui.query('[role="switch"][aria-label="Fast mode"]') as HTMLElement;
  expect(fastSwitch).not.toBeNull();
  expect(fastSwitch.getAttribute("aria-checked")).toBe("false");
  ui.flush(() => fastSwitch.click());
  expect(toggles).toBe(1);
});

test("hides Fast when the model cannot use it, and renders nothing with no controls", () => {
  ui.render(<ComposerPickerFooter thinking={thinking} fast={null} />);
  expect(ui.text()).not.toContain("Fast mode");
  ui.render(<ComposerPickerFooter thinking={null} fast={null} />);
  expect(ui.text()).toBe("");
});
