import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, window, type Mounted } from "../test-support/render";
Object.assign(globalThis, { localStorage: window.localStorage });
const { ProjectMark } = await import("./project-mark");
const { resetProjectFaviconRecords } = await import("../lib/session-ui");

let ui: Mounted;
beforeEach(() => {
  resetProjectFaviconRecords();
  ui = mount();
});
afterEach(() => ui.cleanup());

test("shows the project favicon, and the folder icon once it is known to be missing", () => {
  ui.render(<ProjectMark project="erase-site" />);
  expect(ui.query("img")?.getAttribute("src")).toContain("project=erase-site");
  ui.flush(() => ui.query("img")!.dispatchEvent(new window.Event("error")));
  expect(ui.query("img")).toBeNull();
  expect(ui.query("svg")).not.toBeNull();
});
