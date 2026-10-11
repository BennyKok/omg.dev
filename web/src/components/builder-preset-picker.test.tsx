import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { act } from "react";
const { BuilderPresetPicker } = await import("./builder-preset-picker");
let ui: Mounted; beforeEach(() => { ui = mount(); }); afterEach(() => ui.cleanup());
test("shows the workflow choices and sends the selected versioned preset", () => {
  const onChange = mock(() => {});
  ui.render(<BuilderPresetPicker value="" onChange={onChange} />);
  expect(ui.text()).toContain("General"); expect(ui.text()).toContain("App Builder");
  const select = ui.query('select[aria-label="OMG Agent preset"]') as HTMLSelectElement;
  act(() => { select.value = "app-builder-v1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(onChange).toHaveBeenCalledWith("app-builder-v1");
});
test("the selected mode identifies the code reviewer", () => {
  ui.render(<BuilderPresetPicker value="app-builder-v1" onChange={() => {}} />);
  expect(ui.text()).toContain("Apex reviews code");
});
