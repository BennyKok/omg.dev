// The crash screen while lazyWithReload's recovery reload is under way.
// Fails if that moment shows "Something broke" again (an installed iPhone app
// showed it, with the internal reload message, during the guided first run),
// or if a real crash stops saying so.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { AppCrash } = await import("./app-crash");
const { STALE_CHUNK_RELOADING } = await import("@/lib/report-error");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

test("a recovery reload in progress shows Updating, not a crash", () => {
  ui.render(<AppCrash error={new Error(`${STALE_CHUNK_RELOADING}: lfg:chunk-reload:ComputerPage:abc`)} boundary="router" />);
  const text = ui.text();
  expect(text).toContain("Updating omg");
  expect(text).not.toContain("Something broke");
  expect(text).not.toContain(STALE_CHUNK_RELOADING);
});

test("a real render error still shows the crash screen", () => {
  ui.render(<AppCrash error={new Error("Cannot read properties of undefined")} boundary="router" />);
  expect(ui.text()).toContain("Something broke");
});
