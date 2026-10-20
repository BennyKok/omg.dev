import { afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { fillVisibleComposer } from "./guide-fill";
let ui: Mounted;
afterEach(() => ui?.cleanup());

test("fill preserves hidden drafts and focuses only a visible input", () => {
  ui = mount();
  ui.render(<><textarea defaultValue="hidden work" /><textarea defaultValue="visible work" /></>);
  const [hidden, visible] = ui.queryAll("textarea") as HTMLTextAreaElement[];
  visible.getBoundingClientRect = () => ({ top: 10, bottom: 50, left: 0, right: 200, width: 200, height: 40 }) as DOMRect;
  expect(fillVisibleComposer(hidden, text => { hidden.value = text; }, "guide")).toBe(false);
  expect(hidden.value).toBe("hidden work");
  expect(fillVisibleComposer(visible, text => { visible.value = text; }, "guide")).toBe(true);
  expect(visible.value).toBe("guide");
  expect(document.activeElement).toBe(visible);
  const detached = document.createElement("textarea");
  expect(fillVisibleComposer(detached, () => { throw Error("detached input filled"); }, "guide")).toBe(false);
});
